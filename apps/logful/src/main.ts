import pipeline from './pipeline.ts';

const stop = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => stop.abort());

// One pass: the crawl of the input to its end, or to the stop.
await pipeline.run({ signal: stop.signal });
