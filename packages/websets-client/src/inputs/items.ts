import { z } from 'zod';

export const listItemsSchema = z.object({
  cursor: z.string().optional(),
  id: z.string(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});
