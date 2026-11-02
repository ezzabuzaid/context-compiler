import { GotLog } from './got-log.ts';
import pipeline from './pipeline.ts';

const stop = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => stop.abort());

using _log = new GotLog();
// One pass: the crawl of the input to its end, or to the stop.
await pipeline.run({ signal: stop.signal });
