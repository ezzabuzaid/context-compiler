import { Shutdown } from '@zukhruf/shutdown';

import pipeline from './pipeline.ts';

using shutdown = new Shutdown();

const reasonOf = (error: unknown) =>
  Error.isError(error) ? error.message : String(error);

// Each commit of the Mail or Messages import is a pass; the payments and
// charges follow each pass.
for await (const { outcomes } of pipeline.watch({ signal: shutdown.signal }))
  for (const { failures, cancelled } of outcomes) {
    // A pass that the stop ended is cancelled, not failed.
    if (cancelled) continue;
    for (const { error } of failures)
      console.log(`could not read: ${reasonOf(error)}`);
  }
