import type {
  AgentPluginDefinition,
  AgentPluginHost,
} from '@deepagents/experimental/zukhruf';

import type { Evidence } from '../../contracts/evidence.ts';
import type { Journal } from '../../journal/journal.ts';
import { followWarehouse } from '../../warehouse/follow-warehouse.ts';
import project from './projection.ts';
import { ReadBudget } from './read-budget.ts';
import services from './services.ts';
import notify from './tools/notify.ts';
import query from './tools/query.ts';
import sources from './tools/sources.ts';

const conversation = { chatId: 'ambient', userId: 'local-owner' };
type Publisher = Pick<AgentPluginHost, 'enqueue'>;

const changes: AgentPluginDefinition<{
  journal: Journal;
  failure: Promise<never>;
}> = {
  name: 'ambient.changes',
  capabilities: [services],
  create(bindings) {
    const { journal, warehouse, streams, positions } = bindings.get(services);
    const failure = Promise.withResolvers<never>();
    const budget = new ReadBudget();

    async function enqueue(host: Publisher, event: Evidence) {
      if (journal.linked(event.id)) return;
      const receipt = await host.enqueue(conversation, {
        trigger: 'submit-message',
        message: {
          id: event.id,
          role: 'user',
          parts: [
            {
              type: 'text',
              text: JSON.stringify({
                currentChange: event,
              }),
            },
          ],
        },
      });
      journal.link(event.id, receipt.id);
      await receipt.stream.cancel();
    }

    return {
      journal,
      failure: failure.promise,
      async work(host) {
        const stop = new AbortController();
        const running = followWarehouse(
          warehouse,
          positions,
          stop.signal,
          async (source, batch) => {
            for (const change of batch)
              await enqueue(host, journal.capture(source, change));
          },
        );
        void running.catch(failure.reject);
        return {
          async [Symbol.asyncDispose]() {
            stop.abort();
            await running;
          },
        };
      },
      async initialize(host) {
        // Complete only the ingestion handoff interrupted before a queue receipt.
        // PgBoss owns all queued/running inference and crash recovery.
        for (const event of journal.unlinked()) await enqueue(host, event);
        await project(journal, streams, budget);
      },
      conversationAvailable: () => project(journal, streams, budget),
      tools: {
        notify: notify(budget),
        sources: sources(warehouse),
        query: query(warehouse, budget),
      },
    };
  },
};

export default changes;
