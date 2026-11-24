import {
  ExplainAccountingItemInputSchema,
  ExplainAccountingItemOutputSchema,
  GetLegalBasisInputSchema,
  GetLegalBasisOutputSchema,
  GetMonthlyTaxObligationsInputSchema,
  GetMonthlyTaxObligationsOutputSchema,
  PreviewJpkExportInputSchema,
  PreviewJpkExportOutputSchema,
  type ExplainAccountingItemOutput,
  type GetLegalBasisOutput,
  type GetMonthlyTaxObligationsOutput,
  type JpkSchemaFamily,
  type PreviewJpkExportOutput,
} from '@pap/contracts/mcp-tools';
import { resolveCompanyProfileSupportStatus } from '../capability-registry.js';
import {
  authenticateGlobalMcpToolActor,
  authorizeCompanyScopedMcpTool,
  buildAuditUnavailableError,
  denyMcpToolCall,
  recordMcpAuditFailClosed,
  resolveAuthorizedCompanyTaxProfile,
  type McpGateEnvironment,
} from '../gate-runner.js';
import {
  formatGroszeToPln,
  parsePlnToGrosze,
  resolveSafeRequestCorrelationId,
  sanitizeUntrustedDocumentTextForMcp,
} from '../security-and-redaction.js';
import type { McpCallContext, McpGatewayToolResult } from '../types.js';
import { VERIFIED_POLISH_LEGAL_BASIS_CATALOG } from '../vat-classification.js';

export async function handleGetMonthlyTaxObligations(
  env: McpGateEnvironment,
  callContext: McpCallContext,
  rawInput: unknown,
): Promise<McpGatewayToolResult<GetMonthlyTaxObligationsOutput>> {
  const { correlationId } = resolveSafeRequestCorrelationId(callContext.correlationId);
  const parsed = GetMonthlyTaxObligationsInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return denyMcpToolCall(env, {
      toolName: 'get_monthly_tax_obligations',
      correlationId,
      errorCode: 'validation_failed',
      reasonCode: 'invalid_input_schema',
      messagePl:
        'Nieprawidłowe parametry zapytania o obowiązki podatkowe (wymagany okres RRRR-MM).',
    });
  }

  const input = parsed.data;
  const auth = await authorizeCompanyScopedMcpTool(env, {
    toolName: 'get_monthly_tax_obligations',
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

  const obligations = await env.dataSource.listMonthlyTaxObligations(
    auth.actor.tenantId,
    auth.actor.legalEntityId,
    input.period,
  );

  const auditEventId = await recordMcpAuditFailClosed(env, {
    toolName: 'get_monthly_tax_obligations',
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
    promptInjectionSuspected: false,
  });

  if (!auditEventId) {
    return buildAuditUnavailableError();
  }

  return {
    ok: true,
    data: GetMonthlyTaxObligationsOutputSchema.parse({
      tenantId: auth.actor.tenantId,
      legalEntityId: auth.actor.legalEntityId,
      period: input.period,
      obligations: [...obligations],
      auditEventId,
    }),
  };
}

export async function handleExplainAccountingItem(
  env: McpGateEnvironment,
  callContext: McpCallContext,
  rawInput: unknown,
): Promise<McpGatewayToolResult<ExplainAccountingItemOutput>> {
  const { correlationId } = resolveSafeRequestCorrelationId(callContext.correlationId);
  const parsed = ExplainAccountingItemInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return denyMcpToolCall(env, {
      toolName: 'explain_accounting_item',
      correlationId,
      errorCode: 'validation_failed',
      reasonCode: 'invalid_input_schema',
      messagePl: 'Nieprawidłowe parametry zapytania o kwalifikację pozycji księgowej.',
    });
  }

  const input = parsed.data;
  const auth = await authorizeCompanyScopedMcpTool(env, {
    toolName: 'explain_accounting_item',
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

  const item = await env.dataSource.getAccountingItemExplanation(
    auth.actor.tenantId,
    auth.actor.legalEntityId,
    input.accountingItemId.toLowerCase(),
  );

  if (
    !item ||
    item.tenantId !== auth.actor.tenantId ||
    item.legalEntityId !== auth.actor.legalEntityId
  ) {
    return denyMcpToolCall(env, {
      toolName: 'explain_accounting_item',
      correlationId,
      actorUserId: auth.actor.userId,
      actorIssuer: auth.actor.identity.issuer,
      actorSubject: auth.actor.identity.subject,
      tenantId: auth.actor.tenantId,
      legalEntityId: auth.actor.legalEntityId,
      errorCode: 'resource_not_found',
      reasonCode: 'accounting_item_not_found',
      messagePl: 'Nie znaleziono wskazanej pozycji księgowej w wybranej firmie.',
    });
  }

  const sanitizedSummary = sanitizeUntrustedDocumentTextForMcp(item.sourceDocumentSummary, {
    field: 'accountingItem.sourceDocumentSummary',
    maxLength: 800,
  });

  const auditEventId = await recordMcpAuditFailClosed(env, {
    toolName: 'explain_accounting_item',
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
    promptInjectionSuspected: sanitizedSummary.promptInjectionSuspected,
  });

  if (!auditEventId) {
    return buildAuditUnavailableError();
  }

  return {
    ok: true,
    data: ExplainAccountingItemOutputSchema.parse({
      tenantId: auth.actor.tenantId,
      legalEntityId: auth.actor.legalEntityId,
      accountingItemId: item.accountingItemId.toLowerCase(),
      classification: {
        kupAmountPln: item.kupAmountPln,
        nkupAmountPln: item.nkupAmountPln,
        deductibleVatAmountPln: item.deductibleVatAmountPln,
        nonDeductibleVatAmountPln: item.nonDeductibleVatAmountPln,
        taxCategoryCode: item.taxCategoryCode,
        summaryPl: item.summaryPl,
      },
      calculationSteps: [...item.calculationSteps],
      appliedRules: [...item.appliedRules],
      sourceDocumentSummary: sanitizedSummary,
      auditEventId,
    }),
  };
}

export async function handleGetLegalBasis(
  env: McpGateEnvironment,
  callContext: McpCallContext,
  rawInput: unknown,
): Promise<McpGatewayToolResult<GetLegalBasisOutput>> {
  const { correlationId } = resolveSafeRequestCorrelationId(callContext.correlationId);
  const parsed = GetLegalBasisInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return denyMcpToolCall(env, {
      toolName: 'get_legal_basis',
      correlationId,
      errorCode: 'validation_failed',
      reasonCode: 'invalid_input_schema',
      messagePl: 'Nieprawidłowe parametry zapytania o podstawę prawną.',
    });
  }

  const input = parsed.data;
  let actorUserId: string;
  let actorIssuer: string;
  let actorSubject: string;
  let verifiedTenantId: string | null = null;
  let verifiedLegalEntityId: string | null = null;

  if (input.tenantId !== undefined || input.legalEntityId !== undefined) {
    if (!input.tenantId || !input.legalEntityId) {
      return denyMcpToolCall(env, {
        toolName: 'get_legal_basis',
        correlationId,
        errorCode: 'invalid_selector',
        reasonCode: 'incomplete_company_selector',
        messagePl: 'Podając kontekst firmy, wskaż jednocześnie tenantId i legalEntityId.',
      });
    }
    const auth = await authorizeCompanyScopedMcpTool(env, {
      toolName: 'get_legal_basis',
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
    actorUserId = auth.actor.userId;
    actorIssuer = auth.actor.identity.issuer;
    actorSubject = auth.actor.identity.subject;
    verifiedTenantId = auth.actor.tenantId;
    verifiedLegalEntityId = auth.actor.legalEntityId;
  } else {
    const actor = await authenticateGlobalMcpToolActor(env, {
      toolName: 'get_legal_basis',
      correlationId,
      rawBearerToken: callContext.rawBearerToken,
      requiredScopes: ['pap:mcp:read'],
    });
    if (!actor.ok) {
      return actor;
    }
    actorUserId = actor.userId;
    actorIssuer = actor.identity.issuer;
    actorSubject = actor.identity.subject;
  }

  const asOfDate = input.asOfDate ?? env.clock.now().toISOString().slice(0, 10);
  const normalizedCode = input.obligationOrRuleCode.trim().toUpperCase();
  const entry =
    (await env.dataSource.getLegalBasisEntry(normalizedCode, asOfDate)) ??
    VERIFIED_POLISH_LEGAL_BASIS_CATALOG[normalizedCode] ??
    null;

  if (!entry) {
    return denyMcpToolCall(env, {
      toolName: 'get_legal_basis',
      correlationId,
      actorUserId,
      actorIssuer,
      actorSubject,
      tenantId: verifiedTenantId,
      legalEntityId: verifiedLegalEntityId,
      errorCode: 'resource_not_found',
      reasonCode: 'legal_basis_rule_not_found',
      messagePl: `Brak zweryfikowanej reguły prawnej o kodzie ${normalizedCode} na dzień ${asOfDate}.`,
    });
  }

  const auditEventId = await recordMcpAuditFailClosed(env, {
    toolName: 'get_legal_basis',
    correlationId,
    actorUserId,
    actorIssuer,
    actorSubject,
    tenantId: verifiedTenantId,
    legalEntityId: verifiedLegalEntityId,
    outcome: 'allow',
    reasonCode: 'verified_legal_basis_returned',
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
    data: GetLegalBasisOutputSchema.parse({
      code: entry.code,
      titlePl: entry.titlePl,
      summaryPl: entry.summaryPl,
      legalBasis: entry.legalBasis,
      exceptionsPl: [...entry.exceptionsPl],
      disclaimerPl:
        'Informacja oparta na zweryfikowanym katalogu reguł Polish Accounting Platform. Nie stanowi indywidualnej interpretacji podatkowej; ostateczna kwalifikacja i wysyłka deklaracji wymagają zatwierdzenia przez osobę uprawnioną.',
      auditEventId,
    }),
  };
}

export async function handlePreviewJpkExport(
  env: McpGateEnvironment,
  callContext: McpCallContext,
  rawInput: unknown,
): Promise<McpGatewayToolResult<PreviewJpkExportOutput>> {
  const { correlationId } = resolveSafeRequestCorrelationId(callContext.correlationId);
  const parsed = PreviewJpkExportInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return denyMcpToolCall(env, {
      toolName: 'preview_jpk_export',
      correlationId,
      errorCode: 'validation_failed',
      reasonCode: 'invalid_input_schema',
      messagePl: 'Nieprawidłowe parametry podglądu JPK (wymagany okres RRRR-MM).',
    });
  }

  const input = parsed.data;
  const auth = await authorizeCompanyScopedMcpTool(env, {
    toolName: 'preview_jpk_export',
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

  const profile = await resolveAuthorizedCompanyTaxProfile(
    env,
    auth.actor.userId,
    auth.actor.tenantId,
    auth.actor.legalEntityId,
  );
  if (!profile) {
    return denyMcpToolCall(env, {
      toolName: 'preview_jpk_export',
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

  const taxYear = Number(input.period.slice(0, 4));
  const yearSupport = resolveCompanyProfileSupportStatus(profile, taxYear);
  if (yearSupport === 'unsupported') {
    return denyMcpToolCall(env, {
      toolName: 'preview_jpk_export',
      correlationId,
      actorUserId: auth.actor.userId,
      actorIssuer: auth.actor.identity.issuer,
      actorSubject: auth.actor.identity.subject,
      tenantId: auth.actor.tenantId,
      legalEntityId: auth.actor.legalEntityId,
      errorCode: 'capability_unsupported',
      reasonCode: 'jpk_tax_year_unsupported',
      messagePl: `Podgląd JPK dla roku ${taxYear} ma status unsupported.`,
    });
  }

  const expectedIncomeFamily: JpkSchemaFamily =
    profile.taxRegime === 'ryczalt'
      ? 'JPK_EWP'
      : profile.taxRegime === 'cit_klasyczny'
        ? 'JPK_KR_PD'
        : 'JPK_PKPIR';

  const schemaFamily: JpkSchemaFamily =
    input.schemaFamily ?? (profile.vatStatus === 'czynny' ? 'JPK_V7M' : expectedIncomeFamily);

  if (schemaFamily === 'JPK_V7M' && profile.vatStatus !== 'czynny') {
    return denyMcpToolCall(env, {
      toolName: 'preview_jpk_export',
      correlationId,
      actorUserId: auth.actor.userId,
      actorIssuer: auth.actor.identity.issuer,
      actorSubject: auth.actor.identity.subject,
      tenantId: auth.actor.tenantId,
      legalEntityId: auth.actor.legalEntityId,
      errorCode: 'capability_unsupported',
      reasonCode: 'jpk_v7m_unsupported_for_vat_exempt_company',
      messagePl:
        'Podatnik zwolniony z VAT nie składa deklaracji JPK_V7M — użyj struktury ewidencji dochodowej właściwej dla reżimu firmy.',
    });
  }

  if (schemaFamily !== 'JPK_V7M' && schemaFamily !== expectedIncomeFamily) {
    return denyMcpToolCall(env, {
      toolName: 'preview_jpk_export',
      correlationId,
      actorUserId: auth.actor.userId,
      actorIssuer: auth.actor.identity.issuer,
      actorSubject: auth.actor.identity.subject,
      tenantId: auth.actor.tenantId,
      legalEntityId: auth.actor.legalEntityId,
      errorCode: 'capability_unsupported',
      reasonCode: 'jpk_schema_family_mismatch_for_regime',
      messagePl: `Struktura ${schemaFamily} jest niezgodna z reżimem podatkowym firmy (${profile.taxRegime}; właściwa struktura: ${expectedIncomeFamily}).`,
    });
  }

  const nowMs = env.clock.now().getTime();
  let unverifiedProposalsBlockingCount = 0;
  for (const prop of env.state.proposalsById.values()) {
    if (
      prop.tenantId === auth.actor.tenantId &&
      prop.legalEntityId === auth.actor.legalEntityId &&
      (prop.status === 'pending_human_approval' || prop.status === 'confirming') &&
      nowMs < prop.expiresAtMs &&
      prop.invoice.issueDate.startsWith(input.period)
    ) {
      unverifiedProposalsBlockingCount += 1;
    }
  }

  let salesEntriesCount = 0;
  let purchaseEntriesCount = 0;
  let outputVatPln: string;
  let deductibleInputVatPln: string;
  let taxDuePln = '0.00';
  let excessCarryForwardPln = '0.00';

  const vatSnapshot = env.dataSource.getVatPeriodPreviewSnapshot
    ? await env.dataSource.getVatPeriodPreviewSnapshot(
        auth.actor.tenantId,
        auth.actor.legalEntityId,
        input.period,
      )
    : null;

  if (vatSnapshot) {
    salesEntriesCount = vatSnapshot.salesEntriesCount;
    purchaseEntriesCount = vatSnapshot.purchaseEntriesCount;
    outputVatPln = vatSnapshot.outputVatPln;
    deductibleInputVatPln = vatSnapshot.deductibleInputVatPln;
    taxDuePln = vatSnapshot.taxDuePln;
    excessCarryForwardPln = vatSnapshot.excessCarryForwardPln;
  } else {
    const unpaid = await env.dataSource.listUnpaidInvoices(
      auth.actor.tenantId,
      auth.actor.legalEntityId,
    );
    let outVatGrosze = 0n;
    let inVatGrosze = 0n;
    for (const inv of unpaid) {
      if (!inv.issueDate.startsWith(input.period)) {
        continue;
      }
      const vatGr = parsePlnToGrosze(inv.vatAmountPln);
      if (inv.direction === 'sales') {
        salesEntriesCount += 1;
        outVatGrosze += vatGr;
      } else {
        purchaseEntriesCount += 1;
        if (profile.vatStatus === 'czynny') {
          inVatGrosze += vatGr;
        }
      }
    }
    outputVatPln = formatGroszeToPln(outVatGrosze);
    deductibleInputVatPln = formatGroszeToPln(inVatGrosze);
    if (outVatGrosze >= inVatGrosze) {
      taxDuePln = formatGroszeToPln(outVatGrosze - inVatGrosze);
    } else {
      excessCarryForwardPln = formatGroszeToPln(inVatGrosze - outVatGrosze);
    }
  }

  const readinessWarningsPl: string[] = [];
  if (unverifiedProposalsBlockingCount > 0) {
    readinessWarningsPl.push(
      `W okresie ${input.period} oczekują niezatwierdzone propozycje MCP (${unverifiedProposalsBlockingCount}) — zatwierdź lub odrzuć je przed generowaniem ostatecznego pliku JPK.`,
    );
  }
  const monthCloseRaw = await env.dataSource.getMonthCloseRawData(
    auth.actor.tenantId,
    auth.actor.legalEntityId,
    input.period,
  );
  if (monthCloseRaw.missingDocuments.some((d) => d.blocking)) {
    readinessWarningsPl.push(
      'Wykryto dokumenty oczekujące na weryfikację człowieka na liście kontrolnej zamknięcia okresu.',
    );
  }

  const schemaVersionCode =
    schemaFamily === 'JPK_V7M'
      ? 'JPK_V7M(3) 1-0E'
      : schemaFamily === 'JPK_PKPIR'
        ? 'JPK_PKPIR(3)'
        : schemaFamily === 'JPK_EWP'
          ? 'JPK_EWP(4)'
          : 'JPK_KR_PD(1)';

  const legalBasis =
    schemaFamily === 'JPK_V7M'
      ? VERIFIED_POLISH_LEGAL_BASIS_CATALOG['JPK_V7M']!.legalBasis
      : schemaFamily === 'JPK_EWP'
        ? VERIFIED_POLISH_LEGAL_BASIS_CATALOG['RYCZALT_PRZYCHOD_EWIDENCJA']!.legalBasis
        : schemaFamily === 'JPK_KR_PD'
          ? VERIFIED_POLISH_LEGAL_BASIS_CATALOG['CIT_PRZYCHOD_SPRZEDAZ']!.legalBasis
          : VERIFIED_POLISH_LEGAL_BASIS_CATALOG['KUP_OGOLNE']!.legalBasis;

  const capabilityStatus: 'supported' | 'experimental' =
    schemaFamily === 'JPK_V7M' && yearSupport === 'supported' ? 'supported' : 'experimental';

  const auditEventId = await recordMcpAuditFailClosed(env, {
    toolName: 'preview_jpk_export',
    correlationId,
    actorUserId: auth.actor.userId,
    actorIssuer: auth.actor.identity.issuer,
    actorSubject: auth.actor.identity.subject,
    tenantId: auth.actor.tenantId,
    legalEntityId: auth.actor.legalEntityId,
    outcome: 'allow',
    reasonCode: 'jpk_preview_generated_no_external_submission',
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
    data: PreviewJpkExportOutputSchema.parse({
      tenantId: auth.actor.tenantId,
      legalEntityId: auth.actor.legalEntityId,
      period: input.period,
      schemaFamily,
      schemaVersionCode,
      capabilityStatus,
      officialSubmissionPerformed: false,
      upoReferenceNumber: null,
      summary: {
        salesEntriesCount,
        purchaseEntriesCount,
        outputVatPln,
        deductibleInputVatPln,
        taxDuePln,
        excessCarryForwardPln,
        unverifiedProposalsBlockingCount,
      },
      readinessWarningsPl,
      legalBasis,
      disclaimerPl:
        'Podgląd roboczy JPK wygenerowany przez MCP bez podpisu elektronicznego i bez wysyłki do Ministerstwa Finansów (brak UPO).',
      auditEventId,
    }),
  };
}
