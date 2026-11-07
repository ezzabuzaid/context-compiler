import {
  type ZukhrufToolSet,
  defineTool,
} from '@deepagents/experimental/zukhruf';
import { z } from 'zod';

import type { Warehouse } from '../../../warehouse/warehouse.ts';

export default function sources(warehouse: Warehouse): ZukhrufToolSet[string] {
  return defineTool({
    description:
      'List available warehouse sources. Read source.catalog to discover view and column descriptions.',
    inputSchema: z.object({}),
    execute: () =>
      warehouse.sources().map(({ name, error }) => ({ name, error })),
  });
}
