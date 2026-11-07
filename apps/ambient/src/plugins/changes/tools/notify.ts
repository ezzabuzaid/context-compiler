import {
  type AgentPluginToolContext,
  type ZukhrufToolSet,
  defineTool,
} from '@deepagents/experimental/zukhruf';
import type { ModelMessage } from 'ai';
import { z } from 'zod';

import { type Evidence, evidenceSchema } from '../../../contracts/evidence.ts';
import { notificationSchema } from '../../../contracts/notification.ts';
import type { ReadBudget } from '../read-budget.ts';

function observedEvidence(messages: ModelMessage[]): Evidence[] {
  return messages
    .filter((message) => message.role === 'user')
    .flatMap((message) => {
      const text =
        typeof message.content === 'string'
          ? message.content
          : message.content
              .filter((part) => part.type === 'text')
              .map((part) => part.text)
              .join('');
      // Only warehouse changes have this shape; runtime notices do not.
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch (error) {
        if (error instanceof SyntaxError) return [];
        throw error;
      }
      const parsed = z
        .object({ currentChange: evidenceSchema })
        .safeParse(payload);
      if (!parsed.success) return [];
      return [parsed.data.currentChange];
    });
}

export default function notify(budget: ReadBudget): ZukhrufToolSet[string] {
  return defineTool({
    description:
      'Deliver one useful discovery to the user, with supporting evidence IDs. Finishes this change.',
    inputSchema: notificationSchema,
    contextSchema: z.custom<AgentPluginToolContext>(),
    execute: (notification, { context, messages }) => {
      const evidence = [
        ...observedEvidence(messages),
        ...budget.evidence(context.streamId),
      ];
      const ids = new Set(evidence.map((item) => item.id));
      if (notification.evidenceIds.some((id) => !ids.has(id)))
        throw new Error(
          'Notification cites evidence the agent never received.',
        );
      return {
        ...notification,
        evidence: evidence.filter((item) =>
          notification.evidenceIds.includes(item.id),
        ),
      };
    },
  });
}
