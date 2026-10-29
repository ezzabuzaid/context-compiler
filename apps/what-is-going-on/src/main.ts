import { serve } from '@hono/node-server';

import app from './app.ts';
import { startEmbeddingServer } from './embedding-server.ts';
import pipeline from './pipeline.ts';
import sources from './sources.ts';

const port = Number(process.env.PORT ?? 4320);
const stop = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => stop.abort());

await using embeddings = await startEmbeddingServer(8120);
const reader = await pipeline({ sources, embeddings: embeddings.url });
const server = serve({ fetch: app.fetch, port }, () =>
  console.log(`What is going on: http://localhost:${port}`),
);
try {
  for await (const { connection, outcomes } of reader.watch({
    signal: stop.signal,
  }))
    for (const { count, deleted, failures } of outcomes)
      console.log(
        `${connection.name}: ${count} written, ${deleted} deleted${
          failures.length === 0
            ? ''
            : `, ${failures.length} failed: ${failures
                .map(({ error }) => String(error))
                .join('; ')
                .slice(0, 500)}`
        }`,
      );
} catch (error) {
  if (!stop.signal.aborted) throw error;
  console.error(error);
} finally {
  server.close();
}
