import {
  type AgentPluginToolContext,
  type ZukhrufToolSet,
  defineTool,
} from '@deepagents/experimental/zukhruf';
import { z } from 'zod';

import type { Warehouse } from '../../../warehouse/warehouse.ts';
import type { ReadBudget } from '../read-budget.ts';

export default function query(
  warehouse: Warehouse,
  budget: ReadBudget,
): ZukhrufToolSet[string] {
  return defineTool({
    description:
      'Read one SQL SELECT across source.view tables. Begin with SELECT * FROM source.catalog LIMIT 20. Returns at most 20 evidence records. Use LIMIT and select only relevant columns. These are current warehouse facts, not a historical replay snapshot.',
    inputSchema: z.object({ sql: z.string().min(1).max(4000) }),
    contextSchema: z.custom<AgentPluginToolContext>(),
    execute: ({ sql }, { context }) =>
      budget.read(context.streamId, () => warehouse.query(sql)),
  });
}
