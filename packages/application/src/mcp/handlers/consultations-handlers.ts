import type {
  CreateConsultationDraftOutput,
  GetConsultationCaseOutput,
  ListMyConsultationCasesOutput,
  ReplyToConsultationCaseOutput,
} from '@pap/contracts/mcp-tools';
import {
  buildAuditUnavailableError,
  recordMcpAuditFailClosed,
  type McpGateEnvironment,
} from '../gate-runner.js';
import { resolveSafeRequestCorrelationId } from '../security-and-redaction.js';
import type { McpCallContext, McpGatewayToolResult } from '../types.js';

export async function handleListMyConsultationCases(
  env: McpGateEnvironment,
  callContext: McpCallContext,
  rawInput: unknown,
): Promise<McpGatewayToolResult<ListMyConsultationCasesOutput>> {
  const { correlationId } = resolveSafeRequestCorrelationId(callContext.correlationId);
  const res = await env.consultationService.listMyCases(
    {
      rawBearerToken: callContext.rawBearerToken,
      correlationId,
      enforceMcpScopes: true,
    },
    rawInput,
  );
  if (!res.ok) {
    const denyAuditId = await recordMcpAuditFailClosed(env, {
      toolName: 'list_my_cases',
      correlationId,
      actorUserId: null,
      actorIssuer: null,
      actorSubject: null,
      tenantId: null,
      legalEntityId: null,
      outcome: 'deny',
      reasonCode: res.error.errorCode,
      idempotencyKey: null,
      proposalId: null,
      payloadHash: null,
      promptInjectionSuspected: false,
    });
    if (!denyAuditId) {
      return buildAuditUnavailableError();
    }
    return {
      ok: false,
      error: { ...res.error, auditEventId: denyAuditId },
    };
  }

  const auditEventId = await recordMcpAuditFailClosed(env, {
    toolName: 'list_my_cases',
    correlationId,
    actorUserId: null,
    actorIssuer: null,
    actorSubject: null,
    tenantId: null,
    legalEntityId: null,
    outcome: 'allow',
    reasonCode: 'consultation_cases_listed',
    idempotencyKey: null,
    proposalId: null,
    payloadHash: null,
    promptInjectionSuspected: res.data.promptInjectionWarningsCount > 0,
  });
  if (!auditEventId) {
    return buildAuditUnavailableError();
  }

  return {
    ok: true,
    data: {
      ...res.data,
      auditEventId,
    },
  };
}

export async function handleGetConsultationCase(
  env: McpGateEnvironment,
  callContext: McpCallContext,
  rawInput: unknown,
): Promise<McpGatewayToolResult<GetConsultationCaseOutput>> {
  const { correlationId } = resolveSafeRequestCorrelationId(callContext.correlationId);
  const res = await env.consultationService.getConsultationCase(
    {
      rawBearerToken: callContext.rawBearerToken,
      correlationId,
      enforceMcpScopes: true,
    },
    rawInput,
  );
  if (!res.ok) {
    const denyAuditId = await recordMcpAuditFailClosed(env, {
      toolName: 'get_consultation_case',
      correlationId,
      actorUserId: null,
      actorIssuer: null,
      actorSubject: null,
      tenantId: null,
      legalEntityId: null,
      outcome: 'deny',
      reasonCode: res.error.errorCode,
      idempotencyKey: null,
      proposalId: null,
      payloadHash: null,
      promptInjectionSuspected: false,
    });
    if (!denyAuditId) {
      return buildAuditUnavailableError();
    }
    return {
      ok: false,
      error: { ...res.error, auditEventId: denyAuditId },
    };
  }

  const anyInjection =
    res.data.caseDetail.subject.promptInjectionSuspected ||
    res.data.caseDetail.messages.some((m) => m.body.promptInjectionSuspected);

  const auditEventId = await recordMcpAuditFailClosed(env, {
    toolName: 'get_consultation_case',
    correlationId,
    actorUserId: null,
    actorIssuer: null,
    actorSubject: null,
    tenantId: res.data.caseDetail.tenantId,
    legalEntityId: res.data.caseDetail.legalEntityId,
    outcome: 'allow',
    reasonCode: 'consultation_case_read',
    idempotencyKey: null,
    proposalId: res.data.caseDetail.caseId,
    payloadHash: null,
    promptInjectionSuspected: anyInjection,
  });
  if (!auditEventId) {
    return buildAuditUnavailableError();
  }

  return {
    ok: true,
    data: {
      ...res.data,
      auditEventId,
    },
  };
}

export async function handleCreateConsultationDraft(
  env: McpGateEnvironment,
  callContext: McpCallContext,
  rawInput: unknown,
): Promise<McpGatewayToolResult<CreateConsultationDraftOutput>> {
  const { correlationId } = resolveSafeRequestCorrelationId(callContext.correlationId);
  const res = await env.consultationService.createConsultationDraft(
    {
      rawBearerToken: callContext.rawBearerToken,
      correlationId,
      enforceMcpScopes: true,
    },
    rawInput,
  );
  if (!res.ok) {
    const denyAuditId = await recordMcpAuditFailClosed(env, {
      toolName: 'create_consultation_draft',
      correlationId,
      actorUserId: null,
      actorIssuer: null,
      actorSubject: null,
      tenantId: null,
      legalEntityId: null,
      outcome: 'deny',
      reasonCode: res.error.errorCode,
      idempotencyKey: null,
      proposalId: null,
      payloadHash: null,
      promptInjectionSuspected: false,
    });
    if (!denyAuditId) {
      return buildAuditUnavailableError();
    }
    return {
      ok: false,
      error: { ...res.error, auditEventId: denyAuditId },
    };
  }

  const anyInjection =
    res.data.caseDetail.subject.promptInjectionSuspected ||
    res.data.caseDetail.messages.some((m) => m.body.promptInjectionSuspected);

  const auditEventId = await recordMcpAuditFailClosed(env, {
    toolName: 'create_consultation_draft',
    correlationId,
    actorUserId: res.data.caseDetail.createdByUserId,
    actorIssuer: null,
    actorSubject: null,
    tenantId: res.data.caseDetail.tenantId,
    legalEntityId: res.data.caseDetail.legalEntityId,
    outcome: 'allow',
    reasonCode: res.data.idempotentReplay
      ? 'consultation_draft_idempotent_replay'
      : 'consultation_draft_created_no_ledger_write',
    idempotencyKey: res.data.idempotencyKey,
    proposalId: res.data.caseDetail.caseId,
    payloadHash: null,
    promptInjectionSuspected: anyInjection,
  });
  if (!auditEventId) {
    return buildAuditUnavailableError();
  }

  return {
    ok: true,
    data: {
      ...res.data,
      auditEventId,
    },
  };
}

export async function handleReplyToConsultationCase(
  env: McpGateEnvironment,
  callContext: McpCallContext,
  rawInput: unknown,
): Promise<McpGatewayToolResult<ReplyToConsultationCaseOutput>> {
  const { correlationId } = resolveSafeRequestCorrelationId(callContext.correlationId);
  const res = await env.consultationService.replyToConsultationCase(
    {
      rawBearerToken: callContext.rawBearerToken,
      correlationId,
      enforceMcpScopes: true,
    },
    rawInput,
  );
  if (!res.ok) {
    const denyAuditId = await recordMcpAuditFailClosed(env, {
      toolName: 'reply_to_consultation_case',
      correlationId,
      actorUserId: null,
      actorIssuer: null,
      actorSubject: null,
      tenantId: null,
      legalEntityId: null,
      outcome: 'deny',
      reasonCode: res.error.errorCode,
      idempotencyKey: null,
      proposalId: null,
      payloadHash: null,
      promptInjectionSuspected: false,
    });
    if (!denyAuditId) {
      return buildAuditUnavailableError();
    }
    return {
      ok: false,
      error: { ...res.error, auditEventId: denyAuditId },
    };
  }

  const anyInjection = res.data.caseDetail.messages.some((m) => m.body.promptInjectionSuspected);
  const lastMsg = res.data.caseDetail.messages[res.data.caseDetail.messages.length - 1];

  const auditEventId = await recordMcpAuditFailClosed(env, {
    toolName: 'reply_to_consultation_case',
    correlationId,
    actorUserId: lastMsg?.authorUserId ?? null,
    actorIssuer: null,
    actorSubject: null,
    tenantId: res.data.caseDetail.tenantId,
    legalEntityId: res.data.caseDetail.legalEntityId,
    outcome: 'allow',
    reasonCode: res.data.idempotentReplay
      ? 'consultation_reply_idempotent_replay'
      : 'consultation_reply_recorded_no_ledger_write',
    idempotencyKey: res.data.idempotencyKey,
    proposalId: res.data.caseDetail.caseId,
    payloadHash: null,
    promptInjectionSuspected: anyInjection,
  });
  if (!auditEventId) {
    return buildAuditUnavailableError();
  }

  return {
    ok: true,
    data: {
      ...res.data,
      auditEventId,
    },
  };
}
