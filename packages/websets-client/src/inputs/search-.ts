import { z } from 'zod';

export const searchSchema = z.object({
  count: z.coerce.number().int().min(1).max(50).optional().default(10),
  query: z.string(),
});
