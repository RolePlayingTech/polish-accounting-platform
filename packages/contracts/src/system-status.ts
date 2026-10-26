import { z } from 'zod';

export const SystemStatusSchema = z
  .object({
    service: z.literal('Polish Accounting Platform'),
    status: z.literal('ok'),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    modules: z
      .object({
        accounting: z.literal('not_available'),
        tenantAuthorization: z.literal('not_available'),
        remoteMcp: z.literal('not_available'),
      })
      .strict(),
  })
  .strict();

export type SystemStatus = z.infer<typeof SystemStatusSchema>;
