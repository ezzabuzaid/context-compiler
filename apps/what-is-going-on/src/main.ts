import { aborted } from 'node:util';

import { serve } from '@hono/node-server';
import { Shutdown } from '@zukhruf/shutdown';

import app from './app.ts';
import reading from './reading.ts';
import sources from './sources.ts';

const port = Number(process.env.PORT ?? 4320);
using shutdown = new Shutdown();

reading.start({ sources });
const server = serve({ fetch: app.fetch, port }, () =>
  console.log(`What is going on: http://localhost:${port}`),
);
await aborted(shutdown.signal, server);
server.close();
await reading.stop();
