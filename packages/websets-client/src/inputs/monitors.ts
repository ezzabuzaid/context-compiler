import { z } from 'zod';

export const listMonitorEventsSchema = z.object({
  cursor: z.string().optional(),
  id: z.string(),
  limit: z.coerce.number().int().min(1).max(500).optional().default(100),
});
export const listMonitorsSchema = z.object({}).catchall(z.unknown());
export const createMonitorSchema = z.object({
  cron: z.string(),
  name: z.string(),
  target: z.union([
    z.object({ page: z.url() }),
    z.object({
      search: z.object({
        count: z.number().int().min(1).max(50).optional().default(10),
        query: z.string(),
      }),
    }),
    z.object({ dataset: z.string() }),
  ]),
});
export const getMonitorSchema = z.object({ id: z.string() });
export const deleteMonitorSchema = z.object({ id: z.string() });
