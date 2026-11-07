import type { z } from 'zod';

import type { notificationSchema } from './notification.ts';

// Journal outcomes describe actual tool execution, not a second model decision.
export type Decision =
  | { kind: 'silent'; reason: string }
  | (z.infer<typeof notificationSchema> & { kind: 'notify'; reason: string });
