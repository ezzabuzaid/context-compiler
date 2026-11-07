import { once } from 'node:events';
import { aborted } from 'node:util';

import { serve } from '@hono/node-server';
import { Shutdown } from '@zukhruf/shutdown';

import { CrawlError } from '@workspace/sdk-web-crawler';

import app from './app.ts';
import crawl from './crawl.ts';
import { recordEvents } from './events.ts';
import pipeline, { pagesOf } from './pipeline.ts';
import queue, { searches } from './queue.ts';
import { runSearch } from './searching.ts';
import store, { type Crawled } from './store.ts';
import { commits } from './warehouse.ts';

using shutdown = new Shutdown();

const reasonOf = (error: unknown) =>
  Error.isError(error) ? error.message : String(error);

// The starting URLs, criteria and fields that a pipeline is built from:
// when they change, the watch builds the pipeline again.
const shapeOf = (collections: readonly Crawled[]) =>
  JSON.stringify(
    collections.map((collection) => [
      collection.id,
      pagesOf(collection),
      collection.lists,
      collection.criteria,
      collection.fields,
    ]),
  );

// Either loop that fails stops the other, the queue and the API.
const failed = new AbortController();
const watching = AbortSignal.any([shutdown.signal, failed.signal]);

queue.on('error', (error) => console.error(`queue: ${reasonOf(error)}`));
await queue.start();
await queue.createQueue(searches);
await queue.work(searches, async ([job]) => runSearch(job?.data, watching));
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
    // Each round watches one pipeline, until a collection changes its
    // starting URLs, criteria or fields.
    while (!watching.aborted) {
      const rebuilt = crawl.watch();
      const collections = store.crawled();
      const shape = shapeOf(collections);
      const built = await pipeline(collections);
      const ends = AbortSignal.any([watching, rebuilt]);
      if (built === null) {
        // No collection has a starting URL yet: wait for one, or for the
        // stop, on the signal itself. util.aborted() holds its resource
        // weakly and never ends once a GC took it (#3929), and once() never
        // sees an abort that came before it, as a search's rebuild can.
        if (!ends.aborted) {
          await once(ends, 'abort');
        }
        continue;
      }
      try {
        for await (const { outcomes } of built.watch({ signal: ends })) {
          for (const { failures, cancelled } of outcomes) {
            // A pass that the stop ended is cancelled, not failed.
            if (cancelled) continue;
            for (const { error } of failures) {
              const reasons =
                error instanceof AggregateError ? error.errors : [error];
              for (const reason of reasons) {
                if (reason instanceof CrawlError) {
                  // A collection's progress names why a page that its search
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
          // A search that found pages while the pass ran builds the
          // pipeline again, now that no pass runs.
          if (shapeOf(store.crawled()) !== shape) crawl.rebuild();
        }
      } catch (error) {
        // A rebuild ends the watch; any other end is the app's.
        if (watching.aborted || !rebuilt.aborted) throw error;
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
if (failed.signal.aborted && !shutdown.signal.aborted) {
  throw failed.signal.reason;
}
