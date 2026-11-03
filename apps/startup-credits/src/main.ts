import { aborted } from 'node:util';

import { serve } from '@hono/node-server';
import { Shutdown } from '@zukhruf/shutdown';

import { CrawlError } from '@workspace/sdk-web-crawler';

import { MissingPrograms } from './alerts/missing-programs.ts';
import { ModelFailures } from './alerts/model-failures.ts';
import { OfferedPrograms } from './alerts/offered-programs.ts';
import app from './app.ts';
import crawl from './crawl.ts';
import { recordEvents } from './events.ts';
import pipeline from './pipeline.ts';
import { search } from './search.ts';
import store from './store.ts';
import warehouse from './warehouse.ts';

using shutdown = new Shutdown();

const reasonOf = (error: unknown) =>
  Error.isError(error) ? error.message : String(error);

const alerts = [
  new OfferedPrograms(),
  new MissingPrograms(),
  new ModelFailures(),
];
// What the app saw before this start is its baseline: a restart logs only
// what changes after it.
for (const alert of alerts) await alert.baseline(warehouse.sql);
// The event log is the API's, so it catches up with what the warehouse holds
// now, which the log did not report.
recordEvents();

// Either loop that fails stops the other, and the API with them.
const failed = new AbortController();
const watching = AbortSignal.any([shutdown.signal, failed.signal]);
// 4330, beside the elt web app's 4310 and What is going on's 4320; 0 takes
// any free port.
const server = serve(
  { fetch: app.fetch, port: Number(process.env.PORT ?? 4330) },
  ({ port }) => console.log(`API on http://localhost:${port}`),
);
await Promise.all([
  (async () => {
    // Each round watches one pipeline, until a query changes its starting
    // URLs or criteria.
    while (!watching.aborted) {
      const rebuilt = crawl.watch();
      // A new query's search runs first, so the pipeline starts with the
      // pages that it found.
      for (const query of store.queries()) {
        if (query.search.state !== 'pending') continue;
        try {
          store.searched(
            query.id,
            await search(
              query.criteria.map(({ description }) => description),
              watching,
            ),
          );
        } catch (error) {
          if (watching.aborted) throw error;
          store.searchFailed(query.id, reasonOf(error));
          console.log(`could not search for ${query.id}: ${reasonOf(error)}`);
        }
      }
      const passes = (await pipeline(store.configuration())).watch({
        signal: AbortSignal.any([watching, rebuilt]),
      });
      try {
        for await (const { outcomes } of passes)
          for (const { failures, cancelled } of outcomes) {
            // A pass that the stop ended is cancelled, not failed.
            if (cancelled) continue;
            for (const { error } of failures)
              for (const reason of error instanceof AggregateError
                ? error.errors
                : [error]) {
                // The coverage names why a page that a search found did
                // not load, such as a bot challenge.
                if (reason instanceof CrawlError)
                  store.failed(reason.url, reasonOf(reason.cause));
                // A sitemap or robots.txt that a site names but that does
                // not load is the crawl's matter, not a page anyone reads.
                if (reason instanceof CrawlError && !reason.page) continue;
                console.log(
                  reason instanceof CrawlError
                    ? `could not read ${reason.url}: ${reasonOf(reason.cause)}`
                    : `could not read: ${reasonOf(reason)}`,
                );
              }
          }
      } catch (error) {
        // A rebuild ends the watch; any other end is the app's.
        if (watching.aborted || !rebuilt.aborted) throw error;
      }
    }
  })().catch((error: unknown) => failed.abort(error)),
  (async () => {
    for await (const _ of warehouse.commits(watching)) {
      for (const alert of alerts)
        try {
          for await (const line of alert.lines(warehouse.sql))
            console.log(line);
        } catch (error) {
          console.log(`could not check: ${reasonOf(error)}`);
        }
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
if (failed.signal.aborted && !shutdown.signal.aborted)
  throw failed.signal.reason;
