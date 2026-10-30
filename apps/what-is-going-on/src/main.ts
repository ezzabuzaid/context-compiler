import { serve } from '@hono/node-server';

import app from './app.ts';
import reading from './reading.ts';
import sources from './sources.ts';

const port = Number(process.env.PORT ?? 4320);
const stop = Promise.withResolvers<void>();
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => stop.resolve());

reading.start({ sources });
const server = serve({ fetch: app.fetch, port }, () =>
  console.log(`What is going on: http://localhost:${port}`),
);
await stop.promise;
server.close();
await reading.stop();
