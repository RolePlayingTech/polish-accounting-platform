import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { SystemStatusSchema } from '@pap/contracts';
import { createStatusServer } from '../src/server.js';

describe('local MCP status shell', () => {
  let client: Client | undefined;
  let server: ReturnType<typeof createStatusServer> | undefined;

  afterEach(async () => {
    await client?.close();
    await server?.close();
    client = undefined;
    server = undefined;
  });

  it('publishes only the non-sensitive read-only status tool', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    server = createStatusServer();
    client = new Client({ name: 'pap-test-client', version: '0.1.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(['system_status']);

    const result = await client.callTool({ name: 'system_status', arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(SystemStatusSchema.parse(result.structuredContent)).toMatchObject({
      service: 'Polish Accounting Platform',
      modules: { tenantAuthorization: 'not_available', remoteMcp: 'not_available' },
    });
  });
});
