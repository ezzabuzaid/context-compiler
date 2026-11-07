import { z } from 'zod';

export const evidenceSchema = z.object({
  id: z.string(),
  source: z.string(),
  data: z.unknown(),
});

export type Evidence = z.infer<typeof evidenceSchema>;
