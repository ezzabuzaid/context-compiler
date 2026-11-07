import { z } from 'zod';

export const notificationSchema = z.strictObject({
  message: z.string().min(1).max(1200),
  evidenceIds: z.array(z.string().min(1)).min(1),
});
