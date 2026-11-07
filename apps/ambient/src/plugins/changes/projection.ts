import type { StreamStore } from '@deepagents/context';
import { z } from 'zod';

import { evidenceSchema } from '../../contracts/evidence.ts';
import { notificationSchema } from '../../contracts/notification.ts';
import type { Journal } from '../../journal/journal.ts';
import type { ReadBudget } from './read-budget.ts';

const deliverySchema = notificationSchema.extend({
  evidence: z.array(evidenceSchema),
});

// Projects each terminal turn stream into the journal: one notify result is a
// delivery, no notify is silence, and anything else is a failure.
export default async function project(
  journal: Journal,
  streams: StreamStore,
  budget: ReadBudget,
): Promise<void> {
  for (const { id, streamId } of journal.unrecorded()) {
    const stream = await streams.getStream(streamId);
    if (!stream || stream.status === 'queued' || stream.status === 'running')
      continue;
    const chunks = (await streams.getChunks(streamId)).map(
      (chunk) => chunk.data,
    );
    const calls = new Set(
      chunks.flatMap((chunk) =>
        (chunk.type === 'tool-input-available' ||
          chunk.type === 'tool-input-error') &&
        chunk.toolName === 'notify'
          ? [chunk.toolCallId]
          : [],
      ),
    );
    const failed = chunks.find(
      (chunk) =>
        (chunk.type === 'tool-output-error' ||
          chunk.type === 'tool-input-error') &&
        calls.has(chunk.toolCallId),
    );
    const delivered = chunks.filter(
      (chunk) =>
        chunk.type === 'tool-output-available' && calls.has(chunk.toolCallId),
    );
    if (stream.status !== 'completed' || failed || delivered.length > 1) {
      journal.fail(
        id,
        failed?.type === 'tool-output-error' ||
          failed?.type === 'tool-input-error'
          ? failed.errorText
          : delivered.length > 1
            ? 'A change can deliver only one notification.'
            : (stream.error ?? stream.status),
      );
    } else {
      const notification = delivered[0];
      if (notification?.type === 'tool-output-available') {
        const { evidence, ...delivery } = deliverySchema.parse(
          notification.output,
        );
        journal.finish(
          id,
          { kind: 'notify', ...delivery, reason: 'Agent called notify.' },
          evidence,
          stream.finishedAt! - stream.startedAt!,
        );
      } else {
        journal.finish(
          id,
          {
            kind: 'silent',
            reason: 'Agent finished without calling notify.',
          },
          [],
          stream.finishedAt! - stream.startedAt!,
        );
      }
    }
    budget.release(streamId);
  }
}
