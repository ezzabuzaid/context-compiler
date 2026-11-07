import { z } from 'zod';

export const listEventsSchema = z.object({
  cursor: z.string().optional(),
  id: z.string(),
  limit: z.coerce.number().int().min(1).max(500).optional().default(100),
});
