import { aborted } from 'node:util';

import { serve } from '@hono/node-server';
import { Shutdown } from '@zukhruf/shutdown';

import app from './http/app.ts';
import changes from './plugins/changes/index.ts';
import runtime from './run.ts';
import stack from './stack.ts';

using shutdown = new Shutdown();
await using resources = new AsyncDisposableStack();
const host = resources.use(await runtime.initialize(stack));
const observer = host.plugin(changes);
await Promise.race([host.work(), observer.failure]);

const port = Number(process.env.AMBIENT_PORT ?? 4325);
const server = serve({
  fetch: app(observer.journal).fetch,
  hostname: '127.0.0.1',
  port,
});
console.log(`Ambient: http://127.0.0.1:${port}`);
try {
  await Promise.race([aborted(shutdown.signal, server), observer.failure]);
} finally {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
