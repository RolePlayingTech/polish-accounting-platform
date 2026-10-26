import { McpServer } from '@modelcontextprotocol/server';
import { getSystemStatus } from '@pap/application';
import { SystemStatusSchema } from '@pap/contracts';
import { z } from 'zod';

export function createStatusServer(): McpServer {
  const server = new McpServer({ name: 'polish-accounting-platform', version: '0.1.0' });

  server.registerTool(
    'system_status',
    {
      title: 'Status systemu',
      description:
        'Zwraca publiczny status aplikacji i informację o dostępności modułów. Nie udostępnia danych firm ani dokumentów.',
      inputSchema: z.object({}).strict(),
      outputSchema: SystemStatusSchema,
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async () => {
      const status = getSystemStatus();
      return {
        content: [{ type: 'text', text: JSON.stringify(status) }],
        structuredContent: status,
      };
    },
  );

  return server;
}
