import { z } from 'zod';

/** What the Stop hook sends the router: the session and its last message. */
export const waitRequestSchema = z.object({
  session: z.string(),
  cwd: z.string(),
  request: z.string(),
});
export type WaitRequest = z.infer<typeof waitRequestSchema>;

/** What the router sends back when a notification answers the request. */
export const deliverySchema = z.object({ text: z.string() });
export type Delivery = z.infer<typeof deliverySchema>;
