import { aborted } from 'node:util';

import { serve } from '@hono/node-server';
import { Shutdown } from '@zukhruf/shutdown';

import { CrawlError } from '@eltjs/sdk-web-crawler';

import app from './app.ts';
import { recordEvents } from './events.ts';
import { runMonitor } from './monitoring.ts';
import pipeline from './pipeline.ts';
import queue, { monitors, searches } from './queue.ts';
import { runSearch } from './searching.ts';
import store from './store.ts';
import { commits } from './warehouse.ts';
import client from './web-client.ts';

using shutdown = new Shutdown();

const reasonOf = (error: unknown) =>
  Error.isError(error) ? error.message : String(error);

// Either loop that fails stops the other, the queue and the API.
const failed = new AbortController();
const watching = AbortSignal.any([shutdown.signal, failed.signal]);

queue.on('error', (error) => console.error(`queue: ${reasonOf(error)}`));
await queue.start();
await queue.createQueue(searches);
await queue.work(searches, async ([job]) => runSearch(job?.data, watching));
await queue.createQueue(monitors);
await queue.work(monitors, async ([job]) => runMonitor(job?.data, watching));
// The event log is the API's, so it catches up with what the warehouse holds
// now, which the log did not report.
recordEvents();

// 4340, beside the elt web app's 4310, What is going on's 4320 and the OTLP
// collector's 4318; 0 takes any free port.
const server = serve(
  { fetch: app.fetch, port: Number(process.env.PORT ?? 4340) },
  ({ port }) => console.log(`API on http://localhost:${port}`),
);
await Promise.all([
  (async () => {
    // One pipeline for the life of the app: the web source reads the
    // datasets' starting URLs from api.sqlite at each check, and the
    // definitions source their criteria and fields.
    const built = await pipeline();
    for await (const { outcomes } of built.watch({ signal: watching })) {
      for (const { failures, cancelled } of outcomes) {
        // A pass that the stop ended is cancelled, not failed.
        if (cancelled) continue;
        for (const { error } of failures) {
          const reasons =
            error instanceof AggregateError ? error.errors : [error];
          for (const reason of reasons) {
            if (reason instanceof CrawlError) {
              // A dataset's progress names why a page that its search
              // found did not load, such as a bot challenge.
              store.failed(reason.url, reasonOf(reason.cause));
              console.log(
                `could not read ${reason.url}: ${reasonOf(reason.cause)}`,
              );
            } else {
              console.log(`could not read: ${reasonOf(reason)}`);
            }
          }
        }
      }
    }
  })().catch((error: unknown) => failed.abort(error)),
  (async () => {
    for await (const _ of commits(watching)) {
      try {
        recordEvents();
      } catch (error) {
        console.log(`could not record events: ${reasonOf(error)}`);
      }
    }
  })().catch((error: unknown) => failed.abort(error)),
  (async () => {
    await aborted(watching, server);
    server.close();
  })(),
]);
await queue.stop();
await client[Symbol.asyncDispose]();
if (failed.signal.aborted && !shutdown.signal.aborted) {
  throw failed.signal.reason;
}
