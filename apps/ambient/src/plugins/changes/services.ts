import type { StreamStore } from '@deepagents/context';
import { AgentPluginCapability } from '@deepagents/experimental/zukhruf';

import type { Journal } from '../../journal/journal.ts';
import type { Warehouse } from '../../warehouse/warehouse.ts';

export default new AgentPluginCapability<{
  journal: Journal;
  warehouse: Warehouse;
  streams: StreamStore;
  positions: string;
}>('ambient.services');
