import { join } from 'node:path';

import { Shutdown } from '@zukhruf/shutdown';

import { CrawlError } from '@eltjs/sdk-web-crawler';
import { CallFailures } from '@workspace/model-calls/call-failures';

import { MissingPrograms } from './alerts/missing-programs.ts';
import { ModelFailures } from './alerts/model-failures.ts';
import { OfferedPrograms } from './alerts/offered-programs.ts';
import directory from './directory.ts';
import pipeline from './pipeline.ts';
import { CreditsWarehouse } from './warehouse.ts';

using shutdown = new Shutdown();

const reasonOf = (error: unknown) =>
  Error.isError(error) ? error.message : String(error);

using warehouse = new CreditsWarehouse(join(directory, 'credits.sqlite'));
const alerts = [
  new OfferedPrograms(),
  new MissingPrograms(),
  new ModelFailures(),
];
// What the app saw before this start is its baseline: a restart logs only
// what changes after it.
for (const alert of alerts) await alert.baseline(warehouse.sql);

// Either loop that fails stops the other.
const failed = new AbortController();
const watching = AbortSignal.any([shutdown.signal, failed.signal]);
await Promise.all([
  (async () => {
    for await (const event of pipeline.watch({ signal: watching })) {
      // A derived dataset that failed fails alone and the passes go on, but
      // a missing or rejected credential fails every refresh, so the app
      // stops.
      if (event.kind === 'refresh') {
        if (CallFailures.isCredentialError(event.error)) throw event.error;
        console.log(
          `could not refresh ${event.dataset}: ${reasonOf(event.error)}`,
        );
        continue;
      }
      for (const { failures, cancelled } of event.outcomes) {
        // A pass that the stop ended is cancelled, not failed.
        if (cancelled) continue;
        for (const { error } of failures)
          for (const reason of error instanceof AggregateError
            ? error.errors
            : [error]) {
            // A sitemap or robots.txt that a site names but that does not
            // load is the crawl's matter, not a page anyone reads.
            if (reason instanceof CrawlError && !reason.page) continue;
            console.log(
              reason instanceof CrawlError
                ? `could not read ${reason.url}: ${reasonOf(reason.cause)}`
                : `could not read: ${reasonOf(reason)}`,
            );
          }
      }
    }
  })().catch((error: unknown) => failed.abort(error)),
  (async () => {
    for await (const _ of warehouse.commits(watching))
      for (const alert of alerts)
        try {
          for await (const line of alert.lines(warehouse.sql))
            console.log(line);
        } catch (error) {
          console.log(`could not check: ${reasonOf(error)}`);
        }
  })().catch((error: unknown) => failed.abort(error)),
]);
if (failed.signal.aborted && !shutdown.signal.aborted)
  throw failed.signal.reason;
