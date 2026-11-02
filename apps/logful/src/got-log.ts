import { subscribe, unsubscribe } from 'node:diagnostics_channel';

import { z } from 'zod';

// The fields this log reads of the messages of Got's diagnostics channels
// (got/dist/source/core/diagnostics-channel.d.ts, Got 16.1.0). A channel
// gives its subscribers unknown values.
const timings = z
  .object({
    socket: z.number().optional(),
    lookup: z.number().optional(),
    connect: z.number().optional(),
    phases: z.object({
      wait: z.number().optional(),
      dns: z.number().optional(),
      tcp: z.number().optional(),
      tls: z.number().optional(),
      firstByte: z.number().optional(),
      download: z.number().optional(),
      total: z.number().optional(),
    }),
  })
  .optional();
const requestCreate = z.object({ requestId: z.string(), url: z.string() });
const responseStart = z.object({
  requestId: z.string(),
  isFromCache: z.boolean(),
});
const responseEnd = z.object({
  requestId: z.string(),
  url: z.string(),
  statusCode: z.number(),
  bodySize: z.number().optional(),
  timings,
});
const requestError = z.object({
  requestId: z.string(),
  url: z.string(),
  error: z.instanceof(Error),
  timings,
});
const requestRetry = z.object({
  requestId: z.string(),
  retryCount: z.number(),
  delay: z.number(),
  error: z.instanceof(Error),
});

// Heritrix's StatisticsTracker interval.
const interval = 20_000;

// What Got's diagnostics channels tell of the crawl's requests: a line for
// each request that ends, fails or is retried, as Heritrix's crawl.log has a
// line for each URI; a progress line every 20 seconds, with the rate of the
// interval and of the run, as its progress-statistics.log; and a summary
// when it is disposed. The wall time between two progress lines is printed
// when it exceeds the interval by half, as Scrapy's PeriodicLog prints
// log_interval_real, so a stall or a sleep of the Mac shows.
export class GotLog implements Disposable {
  readonly #started = Date.now();
  // The URL and the cache answer of each request that has not ended.
  readonly #urls = new Map<string, string>();
  readonly #cached = new Map<string, boolean>();
  readonly #outcomes = new Map<number | string, number>();
  readonly #totals: number[] = [];
  readonly #firstBytes: number[] = [];
  #requests = 0;
  #bytes = 0;
  #fromCache = 0;
  #retries = 0;
  #last = { at: this.#started, requests: 0 };
  readonly #timer = setInterval(() => this.#progress(), interval);
  readonly #handlers = {
    'got:request:create': (message: unknown) => {
      const { requestId, url } = requestCreate.parse(message);
      this.#urls.set(requestId, url);
    },
    'got:response:start': (message: unknown) => {
      const { requestId, isFromCache } = responseStart.parse(message);
      this.#cached.set(requestId, isFromCache);
    },
    'got:response:end': (message: unknown) => {
      const { requestId, url, statusCode, bodySize, timings } =
        responseEnd.parse(message);
      const cached = this.#cached.get(requestId) === true;
      this.#end(requestId, statusCode, timings);
      this.#bytes += bodySize ?? 0;
      if (cached) this.#fromCache++;
      console.log(
        [
          new Date().toISOString(),
          String(statusCode).padStart(5),
          `${bodySize ?? '-'}B`.padStart(9),
          milliseconds(timings?.phases.total).padStart(7),
          phases(timings),
          cached ? 'cache' : '-',
          url,
        ].join(' '),
      );
    },
    'got:request:error': (message: unknown) => {
      const { requestId, url, error, timings } = requestError.parse(message);
      const code = errorCode(error);
      this.#end(requestId, code, timings);
      console.log(
        [
          new Date().toISOString(),
          'ERROR'.padStart(5),
          '-'.padStart(9),
          milliseconds(timings?.phases.total).padStart(7),
          phases(timings),
          code,
          url,
        ].join(' '),
      );
    },
    'got:request:retry': (message: unknown) => {
      const { requestId, retryCount, delay, error } =
        requestRetry.parse(message);
      this.#retries++;
      console.log(
        [
          new Date().toISOString(),
          'RETRY'.padStart(5),
          `#${retryCount}`,
          `after ${milliseconds(delay)}`,
          errorCode(error),
          this.#urls.get(requestId) ?? '-',
        ].join(' '),
      );
    },
  };

  constructor() {
    for (const [name, handler] of Object.entries(this.#handlers))
      subscribe(name, handler);
  }

  #end(
    requestId: string,
    outcome: number | string,
    timing: z.infer<typeof timings>,
  ) {
    this.#urls.delete(requestId);
    this.#cached.delete(requestId);
    this.#requests++;
    this.#outcomes.set(outcome, (this.#outcomes.get(outcome) ?? 0) + 1);
    if (timing?.phases.total !== undefined)
      this.#totals.push(timing.phases.total);
    if (timing?.phases.firstByte !== undefined)
      this.#firstBytes.push(timing.phases.firstByte);
  }

  #progress() {
    const now = Date.now();
    const wall = now - this.#last.at;
    const recent = ((this.#requests - this.#last.requests) * 1000) / wall;
    const average = (this.#requests * 1000) / (now - this.#started);
    this.#last = { at: now, requests: this.#requests };
    console.log(
      [
        `progress ${new Date(now).toISOString()}`,
        `requests ${this.#requests} (${recent.toFixed(2)}/s now, ${average.toFixed(2)}/s avg)`,
        `in flight ${this.#urls.size}`,
        `cached ${this.#fromCache}`,
        `retries ${this.#retries}`,
        `bytes ${megabytes(this.#bytes)}`,
        ...(wall > interval * 1.5
          ? [`late: ${(wall / 1000).toFixed(1)}s since the last line`]
          : []),
      ].join(' | '),
    );
  }

  [Symbol.dispose]() {
    clearInterval(this.#timer);
    for (const [name, handler] of Object.entries(this.#handlers))
      unsubscribe(name, handler);
    const outcomes = [...this.#outcomes]
      .map(([outcome, count]) => `${outcome}: ${count}`)
      .join(', ');
    console.log(
      [
        `summary: ${this.#requests} requests in ${((Date.now() - this.#started) / 1000).toFixed(1)}s`,
        `  outcomes: ${outcomes || 'none'}`,
        `  from the HTTP cache: ${this.#fromCache}, retries: ${this.#retries}, bytes: ${megabytes(this.#bytes)}`,
        `  total ms p50 ${percentile(this.#totals, 0.5)} p95 ${percentile(this.#totals, 0.95)}`,
        `  first byte ms p50 ${percentile(this.#firstBytes, 0.5)} p95 ${percentile(this.#firstBytes, 0.95)}`,
      ].join('\n'),
    );
  }
}

function errorCode(error: Error) {
  return 'code' in error ? String(error.code) : error.name;
}

function phases(timing: z.infer<typeof timings>) {
  if (timing === undefined) return '[-]';
  const { socket, lookup, connect } = timing;
  const { wait, dns, tcp, tls, firstByte, download } = timing.phases;
  // On a socket that the pool reuses, Got sets lookup and connect to the
  // socket time and copies the first connection's dns, tcp and tls phases
  // (got/dist/source/core/utils/timer.js), so they are not this request's.
  const connection =
    socket !== undefined && lookup === socket && connect === socket
      ? 'reused'
      : `dns ${milliseconds(dns)} tcp ${milliseconds(tcp)} tls ${milliseconds(tls)}`;
  return `[wait ${milliseconds(wait)} ${connection} first ${milliseconds(firstByte)} download ${milliseconds(download)}]`;
}

function milliseconds(value: number | undefined) {
  return value === undefined ? '-' : `${Math.round(value)}ms`;
}

function megabytes(bytes: number) {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function percentile(values: readonly number[], rank: number) {
  const sorted = values.toSorted((a, b) => a - b);
  const value =
    sorted[Math.min(sorted.length - 1, Math.floor(rank * sorted.length))];
  return value === undefined ? '-' : String(Math.round(value));
}
