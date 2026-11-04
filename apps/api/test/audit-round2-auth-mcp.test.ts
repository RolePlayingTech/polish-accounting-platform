import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  COMPANY_JDG_KPIR_ID,
  DEMO_FIRMA_1_PENDING_MCP_PROPOSAL_ID,
  DEMO_USER_JAN_ID,
  DEMO_USER_MARTA_ID,
  SYNTHETIC_COUNTERPARTY_NIPS,
  TENANT_1_ID,
} from '@pap/application';
import {
  IssueMcpChallengeResponseSchema,
  IssueSandboxTokenResponseSchema,
  McpProposalsListResponseSchema,
} from '@pap/contracts';
import {
  ConfirmPreparedProposalOutputSchema,
  PrepareInvoiceAndPostingProposalOutputSchema,
} from '@pap/contracts/mcp-tools';
import { AppModule } from '../src/app.module.js';
import { OidcConfigError } from '../src/auth/oidc-config.js';

describe('Audit Round 2 regressions — P0 scopes/self-approval, P1-1 unified MCP state, P1-2 startup guard, P3 MCP hosts', () => {
  let app: NestFastifyApplication;
  let baseUrl: string;
  let mcpEndpointUrl: URL;
  let janToken: string;
  let martaToken: string;

  async function mintToken(personaId: string, scopes?: readonly string[]): Promise<string> {
    const res = await fetch(`${baseUrl}/api/v1/oidc/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ personaId, ...(scopes ? { scopes } : {}) }),
    });
    expect(res.status).toBe(200);
    return IssueSandboxTokenResponseSchema.parse(await res.json()).accessToken;
  }

  async function withMcpClient<T>(
    bearerToken: string,
    fn: (client: Client) => Promise<T>,
  ): Promise<T> {
    const client = new Client({ name: 'pap-audit-r2-mcp', version: '0.1.0' });
    const transport = new StreamableHTTPClientTransport(mcpEndpointUrl, {
      requestInit: { headers: { Authorization: `Bearer ${bearerToken}` } },
    });
    await client.connect(transport);
    try {
      return await fn(client);
    } finally {
      await transport.close();
    }
  }

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(
      AppModule.register({ PAP_SANDBOX_AUTH_ENABLED: 'true' }),
      new FastifyAdapter({ logger: false }),
      { logger: false, abortOnError: false },
    );
    await app.listen(0, '127.0.0.1');
    const addr = app.getHttpServer().address();
    if (!addr || typeof addr === 'string') {
      throw new Error('Failed to bind ephemeral TCP port');
    }
    baseUrl = `http://127.0.0.1:${addr.port}`;
    mcpEndpointUrl = new URL('/api/v1/mcp', baseUrl);
    janToken = await mintToken('jan-testowy');
    martaToken = await mintToken('marta-ksiegowa');
  });

  afterAll(async () => {
    await app.close();
  });

  it('[P0] blocks autonomous MCP agent self-approval across challenge/confirm/reject/approve-and-post and enforces REST OIDC scopes + required expectedPayloadHash', async () => {
    const autonomousToken = await mintToken('jan-testowy', [
      'openid',
      'pap:ui:full',
      'pap:accounting',
      'pap:mcp:read',
      'pap:mcp:prepare',
      'pap:mcp:agent_autonomous',
    ]);
    const mcpReadOnlyToken = await mintToken('jan-testowy', ['openid', 'pap:mcp:read']);
    const mcpPrepareOnlyToken = await mintToken('jan-testowy', [
      'openid',
      'pap:mcp:read',
      'pap:mcp:prepare',
    ]);
    const openidOnlyToken = await mintToken('jan-testowy', ['openid']);

    const companyBase = `${baseUrl}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}`;

    // Autonomous agent token cannot issue challenge, confirm, reject, approve-and-post, grant, or mutate KPiR
    for (const path of [
      `/mcp/proposals/${DEMO_FIRMA_1_PENDING_MCP_PROPOSAL_ID}/challenge`,
      `/mcp/proposals/${DEMO_FIRMA_1_PENDING_MCP_PROPOSAL_ID}/confirm`,
      `/mcp/proposals/${DEMO_FIRMA_1_PENDING_MCP_PROPOSAL_ID}/reject`,
      `/grants`,
      `/kpir`,
    ]) {
      const res = await fetch(`${companyBase}${path}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${autonomousToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { reasonCode?: string };
      expect(body.reasonCode).toBe('agent_self_approval_forbidden');
    }

    // pap:mcp:read can read GET /kpir (200), but pap:mcp:read and pap:mcp:prepare CANNOT mutate REST or grants (403 insufficient_scope)
    const readKpir = await fetch(`${companyBase}/kpir`, {
      headers: { authorization: `Bearer ${mcpReadOnlyToken}` },
    });
    expect(readKpir.status).toBe(200);

    for (const token of [mcpReadOnlyToken, mcpPrepareOnlyToken]) {
      for (const path of [
        '/kpir',
        '/grants',
        `/mcp/proposals/${DEMO_FIRMA_1_PENDING_MCP_PROPOSAL_ID}/challenge`,
      ]) {
        const mutRes = await fetch(`${companyBase}${path}`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({}),
        });
        expect(mutRes.status).toBe(403);
        const mutBody = (await mutRes.json()) as { reasonCode?: string };
        expect(mutBody.reasonCode).toBe('insufficient_scope');
      }
    }

    // Token with only openid cannot even read protected routes
    const openidRead = await fetch(`${baseUrl}/api/v1/me/companies`, {
      headers: { authorization: `Bearer ${openidOnlyToken}` },
    });
    expect(openidRead.status).toBe(403);

    // Confirm without expectedPayloadHash -> 400 Bad Request
    const missingHashRes = await fetch(
      `${companyBase}/mcp/proposals/${DEMO_FIRMA_1_PENDING_MCP_PROPOSAL_ID}/confirm`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${janToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ confirmationCode: 'PAP-HUMAN-0000000000000000' }),
      },
    );
    expect(missingHashRes.status).toBe(400);
  });

  it('[P1-1] eliminates split-brain: seeded proposal works in MCP, Confirm-after-Reject & Dual-Confirm are blocked, and approvedByUserId records actual human approver', async () => {
    const companyBase = `${baseUrl}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}`;

    // 1. Seeded proposal DEMO_FIRMA_1_PENDING_MCP_PROPOSAL_ID confirmed via MCP -> reflected in REST & blocks Dual-Confirm
    const seededChallengeRes = await fetch(
      `${companyBase}/mcp/proposals/${DEMO_FIRMA_1_PENDING_MCP_PROPOSAL_ID}/challenge`,
      { method: 'POST', headers: { authorization: `Bearer ${janToken}` } },
    );
    expect(seededChallengeRes.status).toBe(200);
    const seededChallenge = IssueMcpChallengeResponseSchema.parse(await seededChallengeRes.json());

    await withMcpClient(janToken, async (client) => {
      const mcpConfirmed = await client.callTool({
        name: 'confirm_prepared_proposal',
        arguments: {
          tenantId: TENANT_1_ID,
          legalEntityId: COMPANY_JDG_KPIR_ID,
          proposalId: DEMO_FIRMA_1_PENDING_MCP_PROPOSAL_ID,
          idempotencyKey: randomUUID(),
          expectedPayloadHash: seededChallenge.payloadHash,
          confirmationCode: seededChallenge.confirmationCode,
        },
      });
      expect(mcpConfirmed.isError).not.toBe(true);
    });

    const listAfterSeedConfirm = McpProposalsListResponseSchema.parse(
      await (
        await fetch(`${companyBase}/mcp/proposals`, {
          headers: { authorization: `Bearer ${janToken}` },
        })
      ).json(),
    );
    expect(
      listAfterSeedConfirm.proposals.find(
        (p) => p.proposalId === DEMO_FIRMA_1_PENDING_MCP_PROPOSAL_ID,
      )?.status,
    ).toBe('confirmed');

    const dualRestAfterMcp = await fetch(
      `${companyBase}/mcp/proposals/${DEMO_FIRMA_1_PENDING_MCP_PROPOSAL_ID}/confirm`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${janToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          confirmationCode: seededChallenge.confirmationCode,
          expectedPayloadHash: seededChallenge.payloadHash,
        }),
      },
    );
    expect(dualRestAfterMcp.status).toBe(409);

    // 2. Confirm-after-Reject: prepare in MCP -> challenge in REST -> reject in REST -> confirm in MCP MUST fail
    const preparedToReject = await withMcpClient(martaToken, async (client) => {
      const res = await client.callTool({
        name: 'prepare_invoice_and_posting_proposal',
        arguments: {
          tenantId: TENANT_1_ID,
          legalEntityId: COMPANY_JDG_KPIR_ID,
          idempotencyKey: randomUUID(),
          invoice: {
            direction: 'purchase',
            invoiceNumber: 'FV/R2-REJECT/01',
            issueDate: '2026-03-21',
            dueDate: '2026-04-04',
            counterpartyName: 'Dostawca Odrzucony Sp. z o.o.',
            counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.dostawcaChmura,
            netAmountPln: '200.00',
            vatAmountPln: '46.00',
            grossAmountPln: '246.00',
            expenseDescription: 'Usługa odrzucona w weryfikacji',
            suggestedCategory: 'uslugi_obce',
          },
        },
      });
      return PrepareInvoiceAndPostingProposalOutputSchema.parse(res.structuredContent);
    });

    const chBeforeReject = IssueMcpChallengeResponseSchema.parse(
      await (
        await fetch(`${companyBase}/mcp/proposals/${preparedToReject.proposalId}/challenge`, {
          method: 'POST',
          headers: { authorization: `Bearer ${janToken}` },
        })
      ).json(),
    );
    const rejectRes = await fetch(
      `${companyBase}/mcp/proposals/${preparedToReject.proposalId}/reject`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${janToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'Błędna faktura' }),
      },
    );
    expect(rejectRes.status).toBe(200);

    await withMcpClient(janToken, async (client) => {
      const confirmAfterReject = await client.callTool({
        name: 'confirm_prepared_proposal',
        arguments: {
          tenantId: TENANT_1_ID,
          legalEntityId: COMPANY_JDG_KPIR_ID,
          proposalId: preparedToReject.proposalId,
          idempotencyKey: randomUUID(),
          expectedPayloadHash: chBeforeReject.payloadHash,
          confirmationCode: chBeforeReject.confirmationCode,
        },
      });
      expect(confirmAfterReject.isError).toBe(true);
    });

    // 3. Dual-Confirm (REST -> MCP) AND Marta prepares / Jan confirms attribution check
    const martaPreparedForDual = await withMcpClient(martaToken, async (client) => {
      const res = await client.callTool({
        name: 'prepare_invoice_and_posting_proposal',
        arguments: {
          tenantId: TENANT_1_ID,
          legalEntityId: COMPANY_JDG_KPIR_ID,
          idempotencyKey: randomUUID(),
          invoice: {
            direction: 'purchase',
            invoiceNumber: 'FV/R2-DUAL/02',
            issueDate: '2026-03-22',
            dueDate: '2026-04-05',
            counterpartyName: 'Dostawca Dual Sp. z o.o.',
            counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.dostawcaSprzetu,
            netAmountPln: '300.00',
            vatAmountPln: '69.00',
            grossAmountPln: '369.00',
            expenseDescription: 'Test podwójnego zatwierdzenia',
            suggestedCategory: 'uslugi_obce',
          },
        },
      });
      return PrepareInvoiceAndPostingProposalOutputSchema.parse(res.structuredContent);
    });

    const dualCh = IssueMcpChallengeResponseSchema.parse(
      await (
        await fetch(`${companyBase}/mcp/proposals/${martaPreparedForDual.proposalId}/challenge`, {
          method: 'POST',
          headers: { authorization: `Bearer ${janToken}` },
        })
      ).json(),
    );
    const restConfirmRes = await fetch(
      `${companyBase}/mcp/proposals/${martaPreparedForDual.proposalId}/confirm`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${janToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          confirmationCode: dualCh.confirmationCode,
          expectedPayloadHash: dualCh.payloadHash,
        }),
      },
    );
    expect(restConfirmRes.status).toBe(200);

    await withMcpClient(janToken, async (client) => {
      const secondConfirmInMcp = await client.callTool({
        name: 'confirm_prepared_proposal',
        arguments: {
          tenantId: TENANT_1_ID,
          legalEntityId: COMPANY_JDG_KPIR_ID,
          proposalId: martaPreparedForDual.proposalId,
          idempotencyKey: randomUUID(),
          expectedPayloadHash: dualCh.payloadHash,
          confirmationCode: dualCh.confirmationCode,
        },
      });
      expect(secondConfirmInMcp.isError).toBe(true);
    });

    // 4. Marta prepares -> Jan confirms via MCP -> approvedByUserId MUST be Jan (not Marta!)
    const martaPreparedForJanMcp = await withMcpClient(martaToken, async (client) => {
      const res = await client.callTool({
        name: 'prepare_invoice_and_posting_proposal',
        arguments: {
          tenantId: TENANT_1_ID,
          legalEntityId: COMPANY_JDG_KPIR_ID,
          idempotencyKey: randomUUID(),
          invoice: {
            direction: 'purchase',
            invoiceNumber: 'FV/R2-APPROVER/03',
            issueDate: '2026-03-23',
            dueDate: '2026-04-06',
            counterpartyName: 'Dostawca Approver Sp. z o.o.',
            counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.dostawcaChmura,
            netAmountPln: '400.00',
            vatAmountPln: '92.00',
            grossAmountPln: '492.00',
            expenseDescription: 'Weryfikacja rzeczywistego zatwierdzającego',
            suggestedCategory: 'uslugi_obce',
          },
        },
      });
      return PrepareInvoiceAndPostingProposalOutputSchema.parse(res.structuredContent);
    });

    const janCh = IssueMcpChallengeResponseSchema.parse(
      await (
        await fetch(`${companyBase}/mcp/proposals/${martaPreparedForJanMcp.proposalId}/challenge`, {
          method: 'POST',
          headers: { authorization: `Bearer ${janToken}` },
        })
      ).json(),
    );
    const janMcpOut = await withMcpClient(janToken, async (client) => {
      const res = await client.callTool({
        name: 'confirm_prepared_proposal',
        arguments: {
          tenantId: TENANT_1_ID,
          legalEntityId: COMPANY_JDG_KPIR_ID,
          proposalId: martaPreparedForJanMcp.proposalId,
          idempotencyKey: randomUUID(),
          expectedPayloadHash: janCh.payloadHash,
          confirmationCode: janCh.confirmationCode,
        },
      });
      expect(res.isError).not.toBe(true);
      return ConfirmPreparedProposalOutputSchema.parse(res.structuredContent);
    });

    const postedDocRes = await fetch(`${companyBase}/documents/${janMcpOut.ledgerEntryId}`, {
      headers: { authorization: `Bearer ${janToken}` },
    });
    expect(postedDocRes.status).toBe(200);
    const postedDoc = (await postedDocRes.json()) as { approvedByUserId: string | null };
    expect(postedDoc.approvedByUserId).toBe(DEMO_USER_JAN_ID);
    expect(postedDoc.approvedByUserId).not.toBe(DEMO_USER_MARTA_ID);
  });

  it('[P1-2] enforces fail-closed OidcConfigError startup rules for PAP_SANDBOX_AUTH_ENABLED and allows explicit private_test double-key', async () => {
    const forbiddenConfigs: Array<Record<string, string>> = [
      { PAP_SANDBOX_AUTH_ENABLED: 'true', NODE_ENV: 'production' },
      {
        PAP_SANDBOX_AUTH_ENABLED: 'true',
        PAP_OIDC_JWKS_URI: 'https://idp.example.com/.well-known/jwks.json',
      },
      { PAP_SANDBOX_AUTH_ENABLED: 'true', PAP_OIDC_ENV: 'production' },
      {
        PAP_SANDBOX_AUTH_ENABLED: 'true',
        PAP_OIDC_ISSUER: 'https://ksiegowosc.roleplayingtech.com',
      },
      {
        PAP_SANDBOX_AUTH_ENABLED: 'true',
        NODE_ENV: 'production',
        PAP_OIDC_ENV: 'private_test',
        PAP_ALLOW_PRIVATE_TEST_SANDBOX_OIDC: 'true',
        PAP_OIDC_JWKS_URI: 'https://idp.example.com/.well-known/jwks.json',
      },
    ];

    for (const badEnv of forbiddenConfigs) {
      await expect(
        NestFactory.create<NestFastifyApplication>(
          AppModule.register(badEnv),
          new FastifyAdapter({ logger: false }),
          { logger: false, abortOnError: false },
        ),
      ).rejects.toThrow(OidcConfigError);
    }

    const validPrivateTestApp = await NestFactory.create<NestFastifyApplication>(
      AppModule.register({
        PAP_SANDBOX_AUTH_ENABLED: 'true',
        NODE_ENV: 'production',
        PAP_OIDC_ENV: 'private_test',
        PAP_ALLOW_PRIVATE_TEST_SANDBOX_OIDC: 'true',
        PAP_OIDC_ISSUER: 'https://ksiegowosc.roleplayingtech.com',
      }),
      new FastifyAdapter({ logger: false }),
      { logger: false, abortOnError: false },
    );
    await validPrivateTestApp.init();
    await validPrivateTestApp.close();
  });

  it('[P3] honours PAP_MCP_ALLOWED_HOSTS & PAP_MCP_ALLOWED_ORIGINS and rejects unauthenticated requests before reading stream body', async () => {
    const customHostApp = await NestFactory.create<NestFastifyApplication>(
      AppModule.register({
        PAP_SANDBOX_AUTH_ENABLED: 'true',
        PAP_MCP_ALLOWED_HOSTS: 'ksiegowosc.roleplayingtech.com',
        PAP_MCP_ALLOWED_ORIGINS: 'https://ksiegowosc.roleplayingtech.com',
      }),
      new FastifyAdapter({ logger: false }),
      { logger: false, abortOnError: false },
    );
    await customHostApp.init();
    try {
      const fastify = customHostApp.getHttpAdapter().getInstance();
      const tokenRes = await fastify.inject({
        method: 'POST',
        url: '/api/v1/oidc/token',
        payload: { personaId: 'jan-testowy' },
      });
      const token = IssueSandboxTokenResponseSchema.parse(tokenRes.json()).accessToken;

      const allowedRes = await fastify.inject({
        method: 'POST',
        url: '/api/v1/mcp',
        headers: {
          host: 'ksiegowosc.roleplayingtech.com',
          origin: 'https://ksiegowosc.roleplayingtech.com',
          authorization: `Bearer ${token}`,
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
        },
        payload: {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'host-test', version: '0.1.0' },
          },
        },
      });
      expect(allowedRes.statusCode).toBe(200);

      const evilHostRes = await fastify.inject({
        method: 'POST',
        url: '/api/v1/mcp',
        headers: {
          host: 'evil.example.com',
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: { jsonrpc: '2.0', id: 1, method: 'ping' },
      });
      expect(evilHostRes.statusCode).toBe(403);

      // Verify pre-body auth rejection does not read stream chunks
      let chunksRead = 0;
      const bodyStream = new Readable({
        read() {
          chunksRead += 1;
          this.push(Buffer.from('{"jsonrpc":"2.0","id":1,"method":"ping"}'));
          this.push(null);
        },
      });
      const unauthStreamRes = await fastify.inject({
        method: 'POST',
        url: '/api/v1/mcp',
        headers: {
          host: 'ksiegowosc.roleplayingtech.com',
          'content-type': 'application/json',
        },
        payload: bodyStream,
      });
      expect(unauthStreamRes.statusCode).toBe(401);
      expect(chunksRead).toBe(0);
    } finally {
      await customHostApp.close();
    }
  });
});
