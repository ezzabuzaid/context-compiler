import { Shutdown } from '@zukhruf/shutdown';

import { CallFailures } from '@workspace/model-calls/call-failures';

import pipeline from './pipeline.ts';

using shutdown = new Shutdown();

const reasonOf = (error: unknown) =>
  Error.isError(error) ? error.message : String(error);

// Each commit of the Mail or Messages import is a pass; the payments and
// charges follow each pass.
for await (const event of pipeline.watch({ signal: shutdown.signal })) {
  // A derived dataset that failed fails alone and the passes go on, but a
  // missing or rejected credential fails every refresh, so ipay stops.
  if (event.kind === 'refresh') {
    if (CallFailures.isCredentialError(event.error)) throw event.error;
    console.log(`could not refresh ${event.dataset}: ${reasonOf(event.error)}`);
    continue;
  }
  for (const { failures, cancelled } of event.outcomes) {
    // A pass that the stop ended is cancelled, not failed.
    if (cancelled) continue;
    for (const { error } of failures)
      console.log(`could not read: ${reasonOf(error)}`);
  }
}
