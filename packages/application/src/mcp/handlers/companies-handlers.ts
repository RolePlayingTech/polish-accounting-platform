import {
  GetCompanyProfileInputSchema,
  GetCompanyProfileOutputSchema,
  ListAvailableCapabilitiesInputSchema,
  ListAvailableCapabilitiesOutputSchema,
  ListMyCompaniesInputSchema,
  ListMyCompaniesOutputSchema,
  MCP_CAPABILITY_CONTRACT_VERSION,
  type GetCompanyProfileOutput,
  type ListAvailableCapabilitiesOutput,
  type ListMyCompaniesOutput,
} from '@pap/contracts/mcp-tools';
import { decideAccountingAccess } from '@pap/domain';
import { authorizeAuthenticatedCompanyAction } from '../../oidc-authentication.js';
import {
  PAP_MCP_TOOL_DESCRIPTORS,
  evaluateCompanyCapabilities,
  resolveCompanyProfileSupportStatus,
} from '../capability-registry.js';
import {
  authenticateGlobalMcpToolActor,
  authorizeCompanyScopedMcpTool,
  buildAuditUnavailableError,
  denyMcpToolCall,
  recordMcpAuditFailClosed,
  resolveAuthorizedCompanyTaxProfile,
  type McpGateEnvironment,
} from '../gate-runner.js';
import { maskNip, resolveSafeRequestCorrelationId } from '../security-and-redaction.js';
import type { McpCallContext, McpGatewayToolResult } from '../types.js';

export async function handleListMyCompanies(
  env: McpGateEnvironment,
  callContext: McpCallContext,
  rawInput: unknown,
): Promise<McpGatewayToolResult<ListMyCompaniesOutput>> {
  const { correlationId } = resolveSafeRequestCorrelationId(callContext.correlationId);
  const parsedInput = ListMyCompaniesInputSchema.safeParse(rawInput);
  if (!parsedInput.success) {
    return denyMcpToolCall(env, {
      toolName: 'list_my_companies',
      correlationId,
      errorCode: 'validation_failed',
      reasonCode: 'invalid_input_schema',
      messagePl: 'Nieprawidłowe parametry wywołania list_my_companies.',
    });
  }

  const actor = await authenticateGlobalMcpToolActor(env, {
    toolName: 'list_my_companies',
    correlationId,
    rawBearerToken: callContext.rawBearerToken,
    requiredScopes: ['pap:mcp:read'],
  });
  if (!actor.ok) {
    return actor;
  }

  const now = env.clock.now();
  const candidates = await env.dataSource.listCandidateCompaniesForUser(actor.userId);
  const accessibleCompanies: ListMyCompaniesOutput['companies'] = [];

  for (const candidate of candidates) {
    const readDecision = decideAccountingAccess({
      userId: actor.userId,
      tenantId: candidate.tenantId,
      legalEntityId: candidate.legalEntityId,
      action: 'read',
      membership: candidate.membership,
      grants: candidate.grants,
      now,
    });

    if (!readDecision.allowed) {
      continue;
    }

    const writeDecision = decideAccountingAccess({
      userId: actor.userId,
      tenantId: candidate.tenantId,
      legalEntityId: candidate.legalEntityId,
      action: 'write',
      membership: candidate.membership,
      grants: candidate.grants,
      now,
    });

    const grantedActions: ('read' | 'write')[] = writeDecision.allowed
      ? ['read', 'write']
      : ['read'];

    accessibleCompanies.push({
      tenantId: candidate.tenantId,
      legalEntityId: candidate.legalEntityId,
      displayName: candidate.displayName,
      maskedNip: maskNip(candidate.nip),
      legalForm: candidate.legalForm,
      taxRegime: candidate.taxRegime,
      vatStatus: candidate.vatStatus,
      grantedActions,
    });
  }

  const auditEventId = await recordMcpAuditFailClosed(env, {
    toolName: 'list_my_companies',
    correlationId,
    actorUserId: actor.userId,
    actorIssuer: actor.identity.issuer,
    actorSubject: actor.identity.subject,
    tenantId: null,
    legalEntityId: null,
    outcome: 'allow',
    reasonCode: 'listed_accessible_companies',
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
    data: ListMyCompaniesOutputSchema.parse({
      companies: accessibleCompanies,
      auditEventId,
    }),
  };
}

async function resolveGrantedActionsForCompany(
  env: McpGateEnvironment,
  callContext: McpCallContext,
  correlationId: string,
  tenantId: string,
  legalEntityId: string,
): Promise<('read' | 'write')[]> {
  const writeProbe = await authorizeAuthenticatedCompanyAction(
    {
      requestId: correlationId,
      rawBearerToken: callContext.rawBearerToken,
      tenantId,
      legalEntityId,
      action: 'write',
      requiredScopes: ['pap:mcp:read'],
    },
    {
      verifier: env.verifier,
      identityResolver: env.identityResolver,
      securityAudit: { recordDecision: async () => undefined },
      authorizationDataSource: env.authorizationDataSource,
      clock: env.clock,
    },
  );
  return writeProbe.allowed ? ['read', 'write'] : ['read'];
}

export async function handleGetCompanyProfile(
  env: McpGateEnvironment,
  callContext: McpCallContext,
  rawInput: unknown,
): Promise<McpGatewayToolResult<GetCompanyProfileOutput>> {
  const { correlationId } = resolveSafeRequestCorrelationId(callContext.correlationId);
  const parsed = GetCompanyProfileInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return denyMcpToolCall(env, {
      toolName: 'get_company_profile',
      correlationId,
      errorCode: 'validation_failed',
      reasonCode: 'invalid_input_schema',
      messagePl: 'Nieprawidłowe parametry wywołania get_company_profile.',
    });
  }

  const input = parsed.data;
  const auth = await authorizeCompanyScopedMcpTool(env, {
    toolName: 'get_company_profile',
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

  const candidates = await env.dataSource.listCandidateCompaniesForUser(auth.actor.userId);
  const candidateMatch = candidates.find(
    (c) => c.tenantId === auth.actor.tenantId && c.legalEntityId === auth.actor.legalEntityId,
  );
  const profile =
    candidateMatch ??
    (await resolveAuthorizedCompanyTaxProfile(
      env,
      auth.actor.userId,
      auth.actor.tenantId,
      auth.actor.legalEntityId,
    ));

  if (!profile) {
    return denyMcpToolCall(env, {
      toolName: 'get_company_profile',
      correlationId,
      actorUserId: auth.actor.userId,
      actorIssuer: auth.actor.identity.issuer,
      actorSubject: auth.actor.identity.subject,
      tenantId: auth.actor.tenantId,
      legalEntityId: auth.actor.legalEntityId,
      errorCode: 'resource_not_found',
      reasonCode: 'company_profile_not_found',
      messagePl: 'Nie znaleziono profilu podatkowego wskazanej firmy.',
    });
  }

  const taxYear = input.taxYear ?? env.clock.now().getUTCFullYear();
  const grantedActions = await resolveGrantedActionsForCompany(
    env,
    callContext,
    correlationId,
    auth.actor.tenantId,
    auth.actor.legalEntityId,
  );

  const activeBooksKind: GetCompanyProfileOutput['activeBooksKind'] =
    profile.taxRegime === 'ryczalt'
      ? 'ewidencja_przychodow'
      : profile.taxRegime === 'cit_klasyczny'
        ? 'ksiegi_rachunkowe_uor'
        : 'kpir';

  const jpkIncomeApplicableCode: GetCompanyProfileOutput['jpkIncomeApplicableCode'] =
    profile.taxRegime === 'ryczalt'
      ? 'JPK_EWP'
      : profile.taxRegime === 'cit_klasyczny'
        ? 'JPK_KR_PD'
        : 'JPK_PKPIR';

  const auditEventId = await recordMcpAuditFailClosed(env, {
    toolName: 'get_company_profile',
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
    data: GetCompanyProfileOutputSchema.parse({
      tenantId: auth.actor.tenantId,
      legalEntityId: auth.actor.legalEntityId,
      displayName: candidateMatch?.displayName ?? `Podmiot ${auth.actor.legalEntityId.slice(0, 8)}`,
      maskedNip: maskNip(candidateMatch?.nip ?? '0000000000'),
      legalForm: profile.legalForm,
      taxRegime: profile.taxRegime,
      vatStatus: profile.vatStatus,
      taxYear,
      profileSupportStatus: resolveCompanyProfileSupportStatus(profile, taxYear),
      grantedActions,
      activeBooksKind,
      jpkVatApplicable: profile.vatStatus === 'czynny',
      jpkIncomeApplicableCode,
      ksefModeSummaryPl:
        'Środowisko pilotażowe / testowe FA(3): wysyłka KSeF wymaga odrębnego autoryzowanego przepływu człowieka (produkcyjny KSeF zablokowany).',
      auditEventId,
    }),
  };
}

export async function handleListAvailableCapabilities(
  env: McpGateEnvironment,
  callContext: McpCallContext,
  rawInput: unknown,
): Promise<McpGatewayToolResult<ListAvailableCapabilitiesOutput>> {
  const { correlationId } = resolveSafeRequestCorrelationId(callContext.correlationId);
  const parsed = ListAvailableCapabilitiesInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return denyMcpToolCall(env, {
      toolName: 'list_available_capabilities',
      correlationId,
      errorCode: 'validation_failed',
      reasonCode: 'invalid_input_schema',
      messagePl: 'Nieprawidłowe parametry wywołania list_available_capabilities.',
    });
  }

  const input = parsed.data;
  const auth = await authorizeCompanyScopedMcpTool(env, {
    toolName: 'list_available_capabilities',
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
      toolName: 'list_available_capabilities',
      correlationId,
      actorUserId: auth.actor.userId,
      actorIssuer: auth.actor.identity.issuer,
      actorSubject: auth.actor.identity.subject,
      tenantId: auth.actor.tenantId,
      legalEntityId: auth.actor.legalEntityId,
      errorCode: 'resource_not_found',
      reasonCode: 'company_tax_profile_not_found',
      messagePl:
        'Nie znaleziono profilu podatkowego firmy wymaganego do oceny capability registry.',
    });
  }

  const taxYear = input.taxYear ?? env.clock.now().getUTCFullYear();
  const grantedActions = await resolveGrantedActionsForCompany(
    env,
    callContext,
    correlationId,
    auth.actor.tenantId,
    auth.actor.legalEntityId,
  );
  const capabilities = evaluateCompanyCapabilities(profile, taxYear);

  const auditEventId = await recordMcpAuditFailClosed(env, {
    toolName: 'list_available_capabilities',
    correlationId,
    actorUserId: auth.actor.userId,
    actorIssuer: auth.actor.identity.issuer,
    actorSubject: auth.actor.identity.subject,
    tenantId: auth.actor.tenantId,
    legalEntityId: auth.actor.legalEntityId,
    outcome: 'allow',
    reasonCode: 'capabilities_evaluated',
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
    data: ListAvailableCapabilitiesOutputSchema.parse({
      contractVersion: MCP_CAPABILITY_CONTRACT_VERSION,
      tenantId: auth.actor.tenantId,
      legalEntityId: auth.actor.legalEntityId,
      taxYear,
      companyProfile: {
        legalForm: profile.legalForm,
        taxRegime: profile.taxRegime,
        vatStatus: profile.vatStatus,
        grantedActions,
      },
      capabilities: [...capabilities],
      registeredTools: [...PAP_MCP_TOOL_DESCRIPTORS],
      auditEventId,
    }),
  };
}
