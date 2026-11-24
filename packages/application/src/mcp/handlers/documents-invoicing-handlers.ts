import { randomUUID } from 'node:crypto';
import {
  ConfirmPreparedProposalInputSchema,
  ConfirmPreparedProposalOutputSchema,
  KsefReferenceNumberSchema,
  ListUnpaidInvoicesInputSchema,
  ListUnpaidInvoicesOutputSchema,
  PrepareInvoiceAndPostingProposalInputSchema,
  PrepareInvoiceAndPostingProposalOutputSchema,
  PreviewInvoicePostingInputSchema,
  PreviewInvoicePostingOutputSchema,
  type ConfirmPreparedProposalInput,
  type ConfirmPreparedProposalOutput,
  type ListUnpaidInvoicesOutput,
  type PrepareInvoiceAndPostingProposalInput,
  type PrepareInvoiceAndPostingProposalOutput,
  type PrepareProposalLifecycleStatus,
  type PreviewInvoicePostingOutput,
} from '@pap/contracts/mcp-tools';
import { resolveCompanyProfileSupportStatus } from '../capability-registry.js';
import {
  authorizeCompanyScopedMcpTool,
  buildAuditUnavailableError,
  denyMcpToolCall,
  isAutonomousAgentToken,
  recordMcpAuditFailClosed,
  resolveAuthorizedCompanyTaxProfile,
  type McpGateEnvironment,
} from '../gate-runner.js';
import {
  computeDaysOverdue,
  constantTimeHexEquals,
  formatGroszeToPln,
  parsePlnToGrosze,
  resolveSafeRequestCorrelationId,
  sanitizeUntrustedDocumentTextForMcp,
  sha256Hex,
} from '../security-and-redaction.js';
import type { McpCallContext, McpGatewayToolResult, StoredPreparedProposal } from '../types.js';
import {
  computeCanonicalMcpInvoicePayloadHash,
  computeProposedAccountingPreview,
  validateAndResolveMcpInvoiceVat,
} from '../vat-classification.js';

export async function handleListUnpaidInvoices(
  env: McpGateEnvironment,
  callContext: McpCallContext,
  rawInput: unknown,
): Promise<McpGatewayToolResult<ListUnpaidInvoicesOutput>> {
  const { correlationId } = resolveSafeRequestCorrelationId(callContext.correlationId);
  const parsed = ListUnpaidInvoicesInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return denyMcpToolCall(env, {
      toolName: 'list_unpaid_invoices',
      correlationId,
      errorCode: 'validation_failed',
      reasonCode: 'invalid_input_schema',
      messagePl: 'Nieprawidłowe parametry filtrowania faktur.',
    });
  }

  const input = parsed.data;
  const auth = await authorizeCompanyScopedMcpTool(env, {
    toolName: 'list_unpaid_invoices',
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

  const asOfDate = env.clock.now().toISOString().slice(0, 10);
  const rawInvoices = await env.dataSource.listUnpaidInvoices(
    auth.actor.tenantId,
    auth.actor.legalEntityId,
  );

  const directionFilter = input.direction ?? 'all';
  const overdueOnly = input.overdueOnly ?? false;
  const minGrossGrosze = input.minGrossAmountPln ? parsePlnToGrosze(input.minGrossAmountPln) : 0n;

  let totalUnpaidGrosze = 0n;
  let overdueCount = 0;
  let promptInjectionWarningsCount = 0;
  let anyInjection = false;
  const items: ListUnpaidInvoicesOutput['invoices'] = [];

  for (const inv of rawInvoices) {
    if (inv.tenantId !== auth.actor.tenantId || inv.legalEntityId !== auth.actor.legalEntityId) {
      continue;
    }
    if (directionFilter !== 'all' && inv.direction !== directionFilter) {
      continue;
    }
    const grossGrosze = parsePlnToGrosze(inv.grossAmountPln);
    if (grossGrosze < minGrossGrosze) {
      continue;
    }
    const effectiveRemaining = parsePlnToGrosze(inv.remainingGrossAmountPln);
    if (effectiveRemaining <= 0n) {
      continue;
    }

    const daysOverdue = computeDaysOverdue(inv.dueDate, asOfDate);
    const isOverdue = daysOverdue > 0;
    if (overdueOnly && !isOverdue) {
      continue;
    }

    const invoiceNumberEnv = sanitizeUntrustedDocumentTextForMcp(inv.invoiceNumber, {
      field: 'invoice.invoiceNumber',
      maxLength: 128,
    });
    const counterpartyEnv = sanitizeUntrustedDocumentTextForMcp(inv.counterpartyName, {
      field: 'invoice.counterpartyName',
      maxLength: 300,
    });
    const descriptionEnv = sanitizeUntrustedDocumentTextForMcp(inv.description, {
      field: 'invoice.description',
      maxLength: 800,
    });

    let validatedKsefRef: string | null = null;
    let ksefInjectionSuspected = false;
    if (inv.ksefReferenceNumber !== null) {
      const normalizedCandidate = inv.ksefReferenceNumber.trim().toUpperCase();
      const ksefCheck = KsefReferenceNumberSchema.safeParse(normalizedCandidate);
      if (ksefCheck.success) {
        validatedKsefRef = ksefCheck.data;
      } else {
        const ksefInspect = sanitizeUntrustedDocumentTextForMcp(inv.ksefReferenceNumber, {
          field: 'invoice.ksefReferenceNumber',
          maxLength: 80,
        });
        ksefInjectionSuspected = ksefInspect.promptInjectionSuspected;
      }
    }

    const hasInjection =
      invoiceNumberEnv.promptInjectionSuspected ||
      counterpartyEnv.promptInjectionSuspected ||
      descriptionEnv.promptInjectionSuspected ||
      ksefInjectionSuspected;

    if (hasInjection) {
      promptInjectionWarningsCount += 1;
      anyInjection = true;
    }

    if (isOverdue) {
      overdueCount += 1;
    }
    totalUnpaidGrosze += effectiveRemaining;

    items.push({
      invoiceId: inv.invoiceId,
      direction: inv.direction,
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      isOverdue,
      daysOverdue,
      netAmountPln: inv.netAmountPln,
      vatAmountPln: inv.vatAmountPln,
      grossAmountPln: inv.grossAmountPln,
      remainingGrossAmountPln: formatGroszeToPln(effectiveRemaining),
      ksefReferenceNumber: validatedKsefRef,
      invoiceNumber: invoiceNumberEnv,
      counterpartyName: counterpartyEnv,
      description: descriptionEnv,
    });
  }

  const auditEventId = await recordMcpAuditFailClosed(env, {
    toolName: 'list_unpaid_invoices',
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
    data: ListUnpaidInvoicesOutputSchema.parse({
      tenantId: auth.actor.tenantId,
      legalEntityId: auth.actor.legalEntityId,
      asOfDate,
      currency: 'PLN',
      totalUnpaidGrossPln: formatGroszeToPln(totalUnpaidGrosze),
      overdueCount,
      promptInjectionWarningsCount,
      invoices: items,
      auditEventId,
    }),
  };
}

function buildSanitizedInvoicePayload(
  rawInvoice: PrepareInvoiceAndPostingProposalInput['invoice'],
  invoiceNumberText: string,
  counterpartyText: string,
  expenseDescText: string,
): PrepareInvoiceAndPostingProposalInput['invoice'] {
  const sanitizedLines = rawInvoice.lines?.map((line, idx) => {
    const lineDescEnv = sanitizeUntrustedDocumentTextForMcp(line.description, {
      field: `invoice.lines.${idx}.description`,
      maxLength: 500,
    });
    const lineReasonEnv = line.vatClassificationReasonPl
      ? sanitizeUntrustedDocumentTextForMcp(line.vatClassificationReasonPl, {
          field: `invoice.lines.${idx}.vatClassificationReasonPl`,
          maxLength: 300,
        })
      : undefined;
    return {
      ...line,
      description: lineDescEnv.sanitizedText,
      ...(lineReasonEnv && lineReasonEnv.sanitizedText.length >= 3
        ? { vatClassificationReasonPl: lineReasonEnv.sanitizedText }
        : {}),
    };
  });

  const headerReasonEnv = rawInvoice.vatClassificationReasonPl
    ? sanitizeUntrustedDocumentTextForMcp(rawInvoice.vatClassificationReasonPl, {
        field: 'invoice.vatClassificationReasonPl',
        maxLength: 300,
      })
    : undefined;

  return {
    ...rawInvoice,
    invoiceNumber: invoiceNumberText,
    counterpartyName: counterpartyText,
    expenseDescription: expenseDescText,
    ...(sanitizedLines ? { lines: sanitizedLines } : {}),
    ...(headerReasonEnv && headerReasonEnv.sanitizedText.length >= 3
      ? { vatClassificationReasonPl: headerReasonEnv.sanitizedText }
      : {}),
  };
}

export async function handlePreviewInvoicePosting(
  env: McpGateEnvironment,
  callContext: McpCallContext,
  rawInput: unknown,
): Promise<McpGatewayToolResult<PreviewInvoicePostingOutput>> {
  const { correlationId } = resolveSafeRequestCorrelationId(callContext.correlationId);
  const parsed = PreviewInvoicePostingInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return denyMcpToolCall(env, {
      toolName: 'preview_invoice_posting',
      correlationId,
      errorCode: 'validation_failed',
      reasonCode: 'invalid_input_schema',
      messagePl:
        'Nieprawidłowe dane faktury do symulacji dekretacji (sprawdź daty, spójność direction/suggestedCategory i strukturę pozycji).',
    });
  }

  const input = parsed.data;
  const auth = await authorizeCompanyScopedMcpTool(env, {
    toolName: 'preview_invoice_posting',
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

  const companyProfile = await resolveAuthorizedCompanyTaxProfile(
    env,
    auth.actor.userId,
    auth.actor.tenantId,
    auth.actor.legalEntityId,
  );
  if (!companyProfile) {
    return denyMcpToolCall(env, {
      toolName: 'preview_invoice_posting',
      correlationId,
      actorUserId: auth.actor.userId,
      actorIssuer: auth.actor.identity.issuer,
      actorSubject: auth.actor.identity.subject,
      tenantId: auth.actor.tenantId,
      legalEntityId: auth.actor.legalEntityId,
      errorCode: 'resource_not_found',
      reasonCode: 'company_tax_profile_not_found',
      messagePl: 'Nie znaleziono profilu podatkowego firmy.',
    });
  }

  const invoiceYear = Number(input.invoice.issueDate.slice(0, 4));
  if (resolveCompanyProfileSupportStatus(companyProfile, invoiceYear) === 'unsupported') {
    return denyMcpToolCall(env, {
      toolName: 'preview_invoice_posting',
      correlationId,
      actorUserId: auth.actor.userId,
      actorIssuer: auth.actor.identity.issuer,
      actorSubject: auth.actor.identity.subject,
      tenantId: auth.actor.tenantId,
      legalEntityId: auth.actor.legalEntityId,
      errorCode: 'capability_unsupported',
      reasonCode: 'invoice_tax_year_unsupported',
      messagePl: `Symulacja dekretacji dla roku podatkowego ${invoiceYear} nie jest wspierana w zweryfikowanym pilocie.`,
    });
  }

  const vatCheck = validateAndResolveMcpInvoiceVat(input.invoice, companyProfile);
  if (!vatCheck.ok) {
    return denyMcpToolCall(env, {
      toolName: 'preview_invoice_posting',
      correlationId,
      actorUserId: auth.actor.userId,
      actorIssuer: auth.actor.identity.issuer,
      actorSubject: auth.actor.identity.subject,
      tenantId: auth.actor.tenantId,
      legalEntityId: auth.actor.legalEntityId,
      errorCode: vatCheck.errorCode,
      reasonCode: vatCheck.reasonCode,
      messagePl: vatCheck.messagePl,
    });
  }

  const invoiceNumberEnv = sanitizeUntrustedDocumentTextForMcp(input.invoice.invoiceNumber, {
    field: 'invoice.invoiceNumber',
    maxLength: 128,
  });
  const counterpartyEnv = sanitizeUntrustedDocumentTextForMcp(input.invoice.counterpartyName, {
    field: 'invoice.counterpartyName',
    maxLength: 300,
  });
  const expenseDescriptionEnv = sanitizeUntrustedDocumentTextForMcp(
    input.invoice.expenseDescription,
    { field: 'invoice.expenseDescription', maxLength: 1000 },
  );

  if (
    invoiceNumberEnv.sanitizedText.length === 0 ||
    counterpartyEnv.sanitizedText.length === 0 ||
    expenseDescriptionEnv.sanitizedText.length === 0
  ) {
    return denyMcpToolCall(env, {
      toolName: 'preview_invoice_posting',
      correlationId,
      actorUserId: auth.actor.userId,
      actorIssuer: auth.actor.identity.issuer,
      actorSubject: auth.actor.identity.subject,
      tenantId: auth.actor.tenantId,
      legalEntityId: auth.actor.legalEntityId,
      errorCode: 'validation_failed',
      reasonCode: 'empty_field_after_control_char_sanitization',
      messagePl: 'Wymagane pola tekstowe faktury są puste po usunięciu znaków sterujących.',
    });
  }

  const sanitizedInvoice = buildSanitizedInvoicePayload(
    input.invoice,
    invoiceNumberEnv.sanitizedText,
    counterpartyEnv.sanitizedText,
    expenseDescriptionEnv.sanitizedText,
  );
  const proposedPosting = computeProposedAccountingPreview(sanitizedInvoice, companyProfile);
  const payloadHash = computeCanonicalMcpInvoicePayloadHash(
    auth.actor.tenantId,
    auth.actor.legalEntityId,
    sanitizedInvoice,
  );
  const promptInjectionSuspected =
    invoiceNumberEnv.promptInjectionSuspected ||
    counterpartyEnv.promptInjectionSuspected ||
    expenseDescriptionEnv.promptInjectionSuspected ||
    vatCheck.anyLinePromptInjectionSuspected;

  const auditEventId = await recordMcpAuditFailClosed(env, {
    toolName: 'preview_invoice_posting',
    correlationId,
    actorUserId: auth.actor.userId,
    actorIssuer: auth.actor.identity.issuer,
    actorSubject: auth.actor.identity.subject,
    tenantId: auth.actor.tenantId,
    legalEntityId: auth.actor.legalEntityId,
    outcome: 'allow',
    reasonCode: 'dry_run_posting_preview_computed',
    idempotencyKey: null,
    proposalId: null,
    payloadHash,
    promptInjectionSuspected,
  });
  if (!auditEventId) {
    return buildAuditUnavailableError();
  }

  return {
    ok: true,
    data: PreviewInvoicePostingOutputSchema.parse({
      tenantId: auth.actor.tenantId,
      legalEntityId: auth.actor.legalEntityId,
      dryRun: true,
      ledgerPosted: false,
      payloadHash,
      vatClassificationStatus: vatCheck.vatClassificationStatus,
      promptInjectionSuspected,
      sanitizedFields: {
        invoiceNumber: invoiceNumberEnv,
        counterpartyName: counterpartyEnv,
        expenseDescription: expenseDescriptionEnv,
      },
      proposedPosting,
      auditEventId,
    }),
  };
}

export async function handlePrepareInvoiceAndPostingProposal(
  env: McpGateEnvironment,
  callContext: McpCallContext,
  rawInput: unknown,
): Promise<McpGatewayToolResult<PrepareInvoiceAndPostingProposalOutput>> {
  const { correlationId } = resolveSafeRequestCorrelationId(callContext.correlationId);
  const parsed = PrepareInvoiceAndPostingProposalInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return denyMcpToolCall(env, {
      toolName: 'prepare_invoice_and_posting_proposal',
      correlationId,
      errorCode: 'validation_failed',
      reasonCode: 'invalid_input_schema',
      messagePl:
        'Nieprawidłowe dane propozycji faktury (sprawdź poprawność dat kalendarzowych, spójność direction z suggestedCategory, dueDate >= issueDate, UUID idempotencyKey oraz brak niedozwolonych pól zatwierdzających).',
    });
  }

  const input = parsed.data;
  const normalizedIdemKey = input.idempotencyKey.toLowerCase();
  const auth = await authorizeCompanyScopedMcpTool(env, {
    toolName: 'prepare_invoice_and_posting_proposal',
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

  const period = input.invoice.issueDate.slice(0, 7);
  if (
    env.dataSource.isPeriodClosed &&
    (await env.dataSource.isPeriodClosed(auth.actor.tenantId, auth.actor.legalEntityId, period))
  ) {
    return denyMcpToolCall(env, {
      toolName: 'prepare_invoice_and_posting_proposal',
      correlationId,
      actorUserId: auth.actor.userId,
      actorIssuer: auth.actor.identity.issuer,
      actorSubject: auth.actor.identity.subject,
      tenantId: auth.actor.tenantId,
      legalEntityId: auth.actor.legalEntityId,
      idempotencyKey: normalizedIdemKey,
      errorCode: 'period_closed',
      reasonCode: 'target_accounting_period_closed',
      messagePl: `Okres sprawozdawczy ${period} jest zamknięty — przygotowanie zapisu wstecznego zostało zablokowane.`,
    });
  }

  const companyProfile = await resolveAuthorizedCompanyTaxProfile(
    env,
    auth.actor.userId,
    auth.actor.tenantId,
    auth.actor.legalEntityId,
  );
  if (!companyProfile) {
    return denyMcpToolCall(env, {
      toolName: 'prepare_invoice_and_posting_proposal',
      correlationId,
      actorUserId: auth.actor.userId,
      actorIssuer: auth.actor.identity.issuer,
      actorSubject: auth.actor.identity.subject,
      tenantId: auth.actor.tenantId,
      legalEntityId: auth.actor.legalEntityId,
      idempotencyKey: normalizedIdemKey,
      errorCode: 'resource_not_found',
      reasonCode: 'company_tax_profile_not_found',
      messagePl:
        'Nie znaleziono zweryfikowanego profilu podatkowego firmy (taxRegime / vatStatus) wymaganego do przygotowania propozycji dekretacji.',
    });
  }

  const invoiceYear = Number(input.invoice.issueDate.slice(0, 4));
  if (resolveCompanyProfileSupportStatus(companyProfile, invoiceYear) === 'unsupported') {
    return denyMcpToolCall(env, {
      toolName: 'prepare_invoice_and_posting_proposal',
      correlationId,
      actorUserId: auth.actor.userId,
      actorIssuer: auth.actor.identity.issuer,
      actorSubject: auth.actor.identity.subject,
      tenantId: auth.actor.tenantId,
      legalEntityId: auth.actor.legalEntityId,
      idempotencyKey: normalizedIdemKey,
      errorCode: 'capability_unsupported',
      reasonCode: 'invoice_tax_year_unsupported',
      messagePl: `Przygotowanie propozycji księgowania dla roku ${invoiceYear} ma status unsupported dla wybranej firmy.`,
    });
  }

  // Fix #112: Validate explicit VAT rates, zero-VAT justification, and multi-rate lines BEFORE creating draft!
  const vatCheck = validateAndResolveMcpInvoiceVat(input.invoice, companyProfile);
  if (!vatCheck.ok) {
    return denyMcpToolCall(env, {
      toolName: 'prepare_invoice_and_posting_proposal',
      correlationId,
      actorUserId: auth.actor.userId,
      actorIssuer: auth.actor.identity.issuer,
      actorSubject: auth.actor.identity.subject,
      tenantId: auth.actor.tenantId,
      legalEntityId: auth.actor.legalEntityId,
      idempotencyKey: normalizedIdemKey,
      errorCode: vatCheck.errorCode,
      reasonCode: vatCheck.reasonCode,
      messagePl: vatCheck.messagePl,
    });
  }

  const invoiceNumberEnv = sanitizeUntrustedDocumentTextForMcp(input.invoice.invoiceNumber, {
    field: 'invoice.invoiceNumber',
    maxLength: 128,
  });
  const counterpartyEnv = sanitizeUntrustedDocumentTextForMcp(input.invoice.counterpartyName, {
    field: 'invoice.counterpartyName',
    maxLength: 300,
  });
  const expenseDescriptionEnv = sanitizeUntrustedDocumentTextForMcp(
    input.invoice.expenseDescription,
    { field: 'invoice.expenseDescription', maxLength: 1000 },
  );

  if (
    invoiceNumberEnv.sanitizedText.length === 0 ||
    counterpartyEnv.sanitizedText.length === 0 ||
    expenseDescriptionEnv.sanitizedText.length === 0
  ) {
    return denyMcpToolCall(env, {
      toolName: 'prepare_invoice_and_posting_proposal',
      correlationId,
      actorUserId: auth.actor.userId,
      actorIssuer: auth.actor.identity.issuer,
      actorSubject: auth.actor.identity.subject,
      tenantId: auth.actor.tenantId,
      legalEntityId: auth.actor.legalEntityId,
      idempotencyKey: normalizedIdemKey,
      errorCode: 'validation_failed',
      reasonCode: 'empty_field_after_control_char_sanitization',
      messagePl:
        'Wymagane pola tekstowe faktury są puste po usunięciu ukrytych znaków sterujących lub Bidi.',
    });
  }

  const sanitizedInvoice = buildSanitizedInvoicePayload(
    input.invoice,
    invoiceNumberEnv.sanitizedText,
    counterpartyEnv.sanitizedText,
    expenseDescriptionEnv.sanitizedText,
  );

  const proposedPosting = computeProposedAccountingPreview(sanitizedInvoice, companyProfile);
  const payloadHash = computeCanonicalMcpInvoicePayloadHash(
    auth.actor.tenantId,
    auth.actor.legalEntityId,
    sanitizedInvoice,
  );

  const requestCanonicalHash = sha256Hex(
    JSON.stringify({
      tenantId: auth.actor.tenantId,
      legalEntityId: auth.actor.legalEntityId,
      taxRegime: companyProfile.taxRegime,
      vatStatus: companyProfile.vatStatus,
      rawInvoice: input.invoice,
    }),
  );

  const idemSlotKey = `${auth.actor.userId}:${auth.actor.tenantId}:${normalizedIdemKey}`;

  return env.mutex.runExclusive([`prepare-idem:${idemSlotKey}`], async () => {
    const existingIdem = env.state.prepareIdempotency.get(idemSlotKey);
    if (existingIdem) {
      if (!constantTimeHexEquals(existingIdem.requestCanonicalHash, requestCanonicalHash)) {
        return denyMcpToolCall(env, {
          toolName: 'prepare_invoice_and_posting_proposal',
          correlationId,
          actorUserId: auth.actor.userId,
          actorIssuer: auth.actor.identity.issuer,
          actorSubject: auth.actor.identity.subject,
          tenantId: auth.actor.tenantId,
          legalEntityId: auth.actor.legalEntityId,
          idempotencyKey: normalizedIdemKey,
          errorCode: 'idempotency_key_payload_conflict',
          reasonCode: 'idempotency_key_reused_with_different_payload',
          messagePl:
            'Klucz idempotencyKey został już użyty z inną zawartością faktury. Użyj nowego klucza UUID dla nowej operacji.',
        });
      }

      const liveProposal = env.state.proposalsById.get(existingIdem.responseData.proposalId);
      const nowMs = env.clock.now().getTime();
      let liveStatus: PrepareProposalLifecycleStatus = 'pending_human_approval';
      let liveLedgerPosted = false;
      if (liveProposal?.status === 'confirmed') {
        liveStatus = 'confirmed';
        liveLedgerPosted = true;
      } else if (liveProposal && nowMs >= liveProposal.expiresAtMs) {
        liveStatus = 'expired';
        liveLedgerPosted = false;
      }

      const replayAuditId = await recordMcpAuditFailClosed(env, {
        toolName: 'prepare_invoice_and_posting_proposal',
        correlationId,
        actorUserId: auth.actor.userId,
        actorIssuer: auth.actor.identity.issuer,
        actorSubject: auth.actor.identity.subject,
        tenantId: auth.actor.tenantId,
        legalEntityId: auth.actor.legalEntityId,
        outcome: 'allow',
        reasonCode: 'idempotent_replay',
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
        data: PrepareInvoiceAndPostingProposalOutputSchema.parse({
          ...existingIdem.responseData,
          status: liveStatus,
          ledgerPosted: liveLedgerPosted,
          idempotentReplay: true,
          auditEventId: replayAuditId,
        }),
      };
    }

    const promptInjectionSuspected =
      invoiceNumberEnv.promptInjectionSuspected ||
      counterpartyEnv.promptInjectionSuspected ||
      expenseDescriptionEnv.promptInjectionSuspected ||
      vatCheck.anyLinePromptInjectionSuspected;

    const now = env.clock.now();
    const createdAtIso = now.toISOString();
    const expiresAtMs = now.getTime() + env.proposalTtlMs;
    const expiresAtIso = new Date(expiresAtMs).toISOString();
    const proposalId = randomUUID();

    const auditEventId = await recordMcpAuditFailClosed(env, {
      toolName: 'prepare_invoice_and_posting_proposal',
      correlationId,
      actorUserId: auth.actor.userId,
      actorIssuer: auth.actor.identity.issuer,
      actorSubject: auth.actor.identity.subject,
      tenantId: auth.actor.tenantId,
      legalEntityId: auth.actor.legalEntityId,
      outcome: 'allow',
      reasonCode: 'draft_proposal_created_pending_human_approval',
      idempotencyKey: normalizedIdemKey,
      proposalId,
      payloadHash,
      promptInjectionSuspected,
    });

    if (!auditEventId) {
      return buildAuditUnavailableError();
    }

    const storedProposal: StoredPreparedProposal = {
      proposalId,
      tenantId: auth.actor.tenantId,
      legalEntityId: auth.actor.legalEntityId,
      createdByUserId: auth.actor.userId,
      idempotencyKey: normalizedIdemKey,
      payloadHash,
      createdAtIso,
      expiresAtMs,
      expiresAtIso,
      status: 'pending_human_approval',
      ledgerEntryId: null,
      confirmedAtIso: null,
      invoice: Object.freeze({ ...sanitizedInvoice }),
      proposedPosting,
    };

    const output = PrepareInvoiceAndPostingProposalOutputSchema.parse({
      proposalId,
      tenantId: auth.actor.tenantId,
      legalEntityId: auth.actor.legalEntityId,
      status: 'pending_human_approval',
      ledgerPosted: false,
      idempotencyKey: normalizedIdemKey,
      idempotentReplay: false,
      payloadHash,
      createdAt: createdAtIso,
      expiresAt: expiresAtIso,
      approvalUiPath: `/approvals/proposals/${proposalId}`,
      humanApprovalInstructionsPl:
        'Szkic propozycji został zapisany w kolejce do weryfikacji (brak zapisu w księgach). Zatwierdzenie wymaga przeglądu przez uprawnionego człowieka w interfejsie aplikacji lub podania jednorazowego kodu potwierdzenia człowieka powiązanego ze skrótem payloadHash.',
      promptInjectionSuspected,
      sanitizedFields: {
        invoiceNumber: invoiceNumberEnv,
        counterpartyName: counterpartyEnv,
        expenseDescription: expenseDescriptionEnv,
      },
      proposedPosting,
      auditEventId,
    });

    env.state.proposalsById.set(proposalId, storedProposal);
    env.state.prepareIdempotency.set(idemSlotKey, {
      requestCanonicalHash,
      responseData: output,
    });

    return {
      ok: true,
      data: output,
    };
  });
}

export async function handleConfirmPreparedProposal(
  env: McpGateEnvironment,
  callContext: McpCallContext,
  rawInput: unknown,
): Promise<McpGatewayToolResult<ConfirmPreparedProposalOutput>> {
  const { correlationId } = resolveSafeRequestCorrelationId(callContext.correlationId);
  const parsed = ConfirmPreparedProposalInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return denyMcpToolCall(env, {
      toolName: 'confirm_prepared_proposal',
      correlationId,
      errorCode: 'validation_failed',
      reasonCode: 'invalid_input_schema',
      messagePl:
        'Wymagane są poprawne parametry: proposalId, idempotencyKey, expectedPayloadHash (SHA-256) oraz jawny confirmationCode człowieka.',
    });
  }

  const input: ConfirmPreparedProposalInput = parsed.data;
  const normalizedIdemKey = input.idempotencyKey.toLowerCase();
  const normalizedProposalId = input.proposalId.toLowerCase();

  const auth = await authorizeCompanyScopedMcpTool(env, {
    toolName: 'confirm_prepared_proposal',
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
      toolName: 'confirm_prepared_proposal',
      correlationId,
      actorUserId: auth.actor.userId,
      actorIssuer: auth.actor.identity.issuer,
      actorSubject: auth.actor.identity.subject,
      tenantId: auth.actor.tenantId,
      legalEntityId: auth.actor.legalEntityId,
      idempotencyKey: normalizedIdemKey,
      proposalId: normalizedProposalId,
      errorCode: 'agent_self_approval_forbidden',
      reasonCode: 'autonomous_agent_cannot_confirm_proposal',
      messagePl: 'Agent autonomiczny MCP nie może samodzielnie zatwierdzić propozycji księgowania.',
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
    [`proposal:${normalizedProposalId}`, `confirm-idem:${idemSlotKey}`],
    async () => {
      const existingConfirm = env.state.confirmIdempotency.get(idemSlotKey);
      if (existingConfirm) {
        if (!constantTimeHexEquals(existingConfirm.requestCanonicalHash, confirmRequestHash)) {
          return denyMcpToolCall(env, {
            toolName: 'confirm_prepared_proposal',
            correlationId,
            actorUserId: auth.actor.userId,
            actorIssuer: auth.actor.identity.issuer,
            actorSubject: auth.actor.identity.subject,
            tenantId: auth.actor.tenantId,
            legalEntityId: auth.actor.legalEntityId,
            idempotencyKey: normalizedIdemKey,
            proposalId: normalizedProposalId,
            errorCode: 'idempotency_key_payload_conflict',
            reasonCode: 'confirm_idempotency_key_conflict',
            messagePl:
              'Klucz idempotencyKey został już użyty do potwierdzenia innej propozycji lub innego skrótu danych.',
          });
        }

        const replayAuditId = await recordMcpAuditFailClosed(env, {
          toolName: 'confirm_prepared_proposal',
          correlationId,
          actorUserId: auth.actor.userId,
          actorIssuer: auth.actor.identity.issuer,
          actorSubject: auth.actor.identity.subject,
          tenantId: auth.actor.tenantId,
          legalEntityId: auth.actor.legalEntityId,
          outcome: 'allow',
          reasonCode: 'confirm_idempotent_replay',
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
          data: ConfirmPreparedProposalOutputSchema.parse({
            ...existingConfirm.responseData,
            idempotentReplay: true,
            auditEventId: replayAuditId,
          }),
        };
      }

      const proposal = env.state.proposalsById.get(normalizedProposalId);
      if (
        !proposal ||
        proposal.tenantId !== auth.actor.tenantId ||
        proposal.legalEntityId !== auth.actor.legalEntityId
      ) {
        return denyMcpToolCall(env, {
          toolName: 'confirm_prepared_proposal',
          correlationId,
          actorUserId: auth.actor.userId,
          actorIssuer: auth.actor.identity.issuer,
          actorSubject: auth.actor.identity.subject,
          tenantId: auth.actor.tenantId,
          legalEntityId: auth.actor.legalEntityId,
          idempotencyKey: normalizedIdemKey,
          proposalId: normalizedProposalId,
          errorCode: 'proposal_not_found_or_forbidden',
          reasonCode: 'proposal_not_found_in_authorized_entity',
          messagePl: 'Nie znaleziono wskazanej propozycji w kontekście uprawnionej firmy.',
        });
      }

      const now = env.clock.now();
      const nowMs = now.getTime();
      const nowIso = now.toISOString();

      if (proposal.status !== 'pending_human_approval') {
        return denyMcpToolCall(env, {
          toolName: 'confirm_prepared_proposal',
          correlationId,
          actorUserId: auth.actor.userId,
          actorIssuer: auth.actor.identity.issuer,
          actorSubject: auth.actor.identity.subject,
          tenantId: auth.actor.tenantId,
          legalEntityId: auth.actor.legalEntityId,
          idempotencyKey: normalizedIdemKey,
          proposalId: normalizedProposalId,
          errorCode: 'proposal_already_processed',
          reasonCode: 'proposal_not_pending',
          messagePl: 'Propozycja została już wcześniej przetworzona.',
        });
      }

      if (nowMs >= proposal.expiresAtMs) {
        return denyMcpToolCall(env, {
          toolName: 'confirm_prepared_proposal',
          correlationId,
          actorUserId: auth.actor.userId,
          actorIssuer: auth.actor.identity.issuer,
          actorSubject: auth.actor.identity.subject,
          tenantId: auth.actor.tenantId,
          legalEntityId: auth.actor.legalEntityId,
          idempotencyKey: normalizedIdemKey,
          proposalId: normalizedProposalId,
          errorCode: 'proposal_expired',
          reasonCode: 'proposal_ttl_expired',
          messagePl: 'Ważność szkicu propozycji wygasła. Przygotuj nowy szkic propozycji.',
        });
      }

      if (!constantTimeHexEquals(proposal.payloadHash, input.expectedPayloadHash)) {
        return denyMcpToolCall(env, {
          toolName: 'confirm_prepared_proposal',
          correlationId,
          actorUserId: auth.actor.userId,
          actorIssuer: auth.actor.identity.issuer,
          actorSubject: auth.actor.identity.subject,
          tenantId: auth.actor.tenantId,
          legalEntityId: auth.actor.legalEntityId,
          idempotencyKey: normalizedIdemKey,
          proposalId: normalizedProposalId,
          errorCode: 'payload_hash_mismatch',
          reasonCode: 'proposal_payload_changed_after_prepare',
          messagePl:
            'Skrót zawartości propozycji (payloadHash) uległ zmianie od momentu przygotowania. Zatwierdzenie zostało zablokowane — wymagany jest nowy szkic.',
        });
      }

      // Fix #112 defense-in-depth at confirmation time: re-verify VAT classification against live company profile!
      const liveProfile = await resolveAuthorizedCompanyTaxProfile(
        env,
        auth.actor.userId,
        auth.actor.tenantId,
        auth.actor.legalEntityId,
      );
      if (liveProfile) {
        const confirmVatCheck = validateAndResolveMcpInvoiceVat(proposal.invoice, liveProfile);
        if (!confirmVatCheck.ok) {
          return denyMcpToolCall(env, {
            toolName: 'confirm_prepared_proposal',
            correlationId,
            actorUserId: auth.actor.userId,
            actorIssuer: auth.actor.identity.issuer,
            actorSubject: auth.actor.identity.subject,
            tenantId: auth.actor.tenantId,
            legalEntityId: auth.actor.legalEntityId,
            idempotencyKey: normalizedIdemKey,
            proposalId: normalizedProposalId,
            errorCode: confirmVatCheck.errorCode,
            reasonCode: confirmVatCheck.reasonCode,
            messagePl: confirmVatCheck.messagePl,
          });
        }
      }

      const challenge = env.state.humanChallengesByProposal.get(normalizedProposalId);
      if (!challenge || challenge.proposalKind !== 'invoice_posting') {
        return denyMcpToolCall(env, {
          toolName: 'confirm_prepared_proposal',
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
            'Brak świeżego potwierdzenia człowieka w UI dla tej propozycji. Samo wywołanie narzędzia MCP nie może zatwierdzić księgowania.',
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
          toolName: 'confirm_prepared_proposal',
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

      proposal.status = 'confirming';
      challenge.consumingInFlight = true;

      const ledgerEntryId = randomUUID();
      const auditEventId = await recordMcpAuditFailClosed(env, {
        toolName: 'confirm_prepared_proposal',
        correlationId,
        actorUserId: auth.actor.userId,
        actorIssuer: auth.actor.identity.issuer,
        actorSubject: auth.actor.identity.subject,
        tenantId: auth.actor.tenantId,
        legalEntityId: auth.actor.legalEntityId,
        outcome: 'allow',
        reasonCode: 'proposal_confirmed_with_human_token',
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

      challenge.consumingInFlight = false;
      challenge.consumedAtIso = nowIso;
      proposal.status = 'confirmed';
      proposal.ledgerEntryId = ledgerEntryId;
      proposal.confirmedAtIso = nowIso;
      proposal.confirmedByUserId = auth.actor.userId;

      const confirmedOutput = ConfirmPreparedProposalOutputSchema.parse({
        proposalId: proposal.proposalId,
        tenantId: proposal.tenantId,
        legalEntityId: proposal.legalEntityId,
        status: 'confirmed',
        ledgerPosted: true,
        ledgerEntryId,
        confirmedAt: nowIso,
        confirmedPayloadHash: proposal.payloadHash,
        idempotencyKey: normalizedIdemKey,
        idempotentReplay: false,
        auditEventId,
      });

      env.state.confirmIdempotency.set(idemSlotKey, {
        requestCanonicalHash: confirmRequestHash,
        responseData: confirmedOutput,
      });

      return {
        ok: true,
        data: confirmedOutput,
      };
    },
  );
}
