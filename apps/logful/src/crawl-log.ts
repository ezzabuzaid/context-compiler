import {
  type Answered,
  CrawlEnded,
  CrawlHandedOff,
  CrawlRequested,
  CrawlStarted,
  OriginBlocked,
  crawlChannels,
} from '@workspace/sdk-web-crawler';
import {
  PageExtracted,
  pageChannels,
} from '@workspace/source-web-pages/page-channels';

// Heritrix's StatisticsTracker interval.
const interval = 20_000;

// Where a stretch of the crawl's wall time went: waiting for its origin's
// delay, in HTTP requests, and in its consumer's work on each entry, of which
// extracting the pages' records is part.
type Spent = {
  waited: number;
  http: number;
  consumer: number;
  extract: number;
};
const nothing = (): Spent => ({ waited: 0, http: 0, consumer: 0, extract: 0 });

// What the crawl and the web source publish on their diagnostics channels: a
// line for each URL of the frontier once its request ended, as Heritrix's
// crawl.log; a line for each block; a progress line every 20 seconds, as its
// progress-statistics.log, with the frontier and where the interval's time
// went; and a summary when it is disposed. The wall time between two
// progress lines is printed when it exceeds the interval by half, as Scrapy's
// PeriodicLog prints log_interval_real, so a stall or a sleep of the Mac
// shows.
export class CrawlLog implements Disposable {
  readonly #started = Date.now();
  readonly #statuses = new Map<number | string, number>();
  #requests = 0;
  #bytes = 0;
  #frontier = '';
  #interval = nothing();
  readonly #total = nothing();
  #last = { at: this.#started, requests: 0 };
  readonly #timer = setInterval(() => this.#progress(), interval);
  readonly #hear = (message: unknown) => {
    if (message instanceof CrawlStarted)
      console.log(
        `${time()} crawl ${message.resumed ? 'continues' : 'starts'}: ${message.starts.join(' ')}`,
      );
    if (message instanceof CrawlRequested) this.#requested(message);
    if (message instanceof CrawlHandedOff)
      this.#spend('consumer', message.duration);
    if (message instanceof PageExtracted)
      this.#spend('extract', message.read + (message.extracted?.duration ?? 0));
    if (message instanceof OriginBlocked)
      console.log(
        `${time()} BLOCK ${message.origin} until ${new Date(message.until).toISOString()}`,
      );
    if (message instanceof CrawlEnded)
      console.log(
        `${time()} crawl ends ${message.complete ? 'complete' : 'incomplete'}${message.nextDue === null ? '' : `, due again ${new Date(message.nextDue).toISOString()}`}`,
      );
  };
  readonly #channels = [...Object.values(crawlChannels), pageChannels.extract];

  constructor() {
    for (const channel of this.#channels) channel.subscribe(this.#hear);
  }

  #requested(request: CrawlRequested) {
    this.#requests++;
    this.#spend('waited', request.waited);
    const roles = `${request.page ? 'P' : '-'}${request.document ? 'D' : '-'}${request.list ? 'L' : '-'}`;
    const { pending, held } = request;
    this.#frontier = `listing ${pending.listing} page ${pending.page} link ${pending.link} backfill ${pending.backfill} held ${held}`;
    const where = `${request.lane.padEnd(8)} ${roles} ${request.served === 'network' ? 'net' : 'rec'}`;
    const via = `via ${request.listingUrl}`;
    if ('error' in request.outcome) {
      const { error } = request.outcome;
      const code = Error.isError(error)
        ? 'code' in error
          ? String(error.code)
          : error.name
        : String(error);
      this.#count(code);
      console.log(
        [
          time(),
          'ERROR'.padStart(5),
          '-'.padStart(9),
          '-'.padStart(7),
          `wait ${milliseconds(request.waited)}`.padEnd(11),
          where,
          code,
          request.url,
          via,
        ].join(' '),
      );
      return;
    }
    const { status, bytes, timings } = request.outcome;
    this.#count(status);
    this.#bytes += bytes;
    const total = timings?.phases.total;
    if (request.served === 'network') this.#spend('http', total ?? 0);
    console.log(
      [
        time(),
        String(status).padStart(5),
        `${bytes}B`.padStart(9),
        milliseconds(total).padStart(7),
        `wait ${milliseconds(request.waited)}`.padEnd(11),
        phases(timings),
        where,
        request.url,
        via,
      ].join(' '),
    );
  }

  #spend(part: keyof Spent, duration: number) {
    this.#interval[part] += duration;
    this.#total[part] += duration;
  }

  #count(key: number | string) {
    this.#statuses.set(key, (this.#statuses.get(key) ?? 0) + 1);
  }

  #progress() {
    const now = Date.now();
    const wall = now - this.#last.at;
    const recent = ((this.#requests - this.#last.requests) * 1000) / wall;
    const average = (this.#requests * 1000) / (now - this.#started);
    console.log(
      [
        `progress ${new Date(now).toISOString()}`,
        `requests ${this.#requests} (${recent.toFixed(2)}/s now, ${average.toFixed(2)}/s avg)`,
        `frontier ${this.#frontier}`,
        `time ${shares(this.#interval, wall)}`,
        ...(wall > interval * 1.5
          ? [`late: ${(wall / 1000).toFixed(1)}s since the last line`]
          : []),
      ].join(' | '),
    );
    this.#last = { at: now, requests: this.#requests };
    this.#interval = nothing();
  }

  [Symbol.dispose]() {
    clearInterval(this.#timer);
    for (const channel of this.#channels) channel.unsubscribe(this.#hear);
    const wall = Date.now() - this.#started;
    const statuses = [...this.#statuses]
      .map(([status, count]) => `${status}: ${count}`)
      .join(', ');
    console.log(
      [
        `summary: ${this.#requests} requests in ${(wall / 1000).toFixed(1)}s, ${(this.#bytes / 1_000_000).toFixed(1)} MB`,
        `  outcomes: ${statuses || 'none'}`,
        `  time: ${shares(this.#total, wall)}`,
      ].join('\n'),
    );
  }
}

// Each part's share of the wall time. The consumer's work holds the crawl,
// so it and the waits and requests add up to about the whole; extraction is
// part of the consumer's work.
function shares(spent: Spent, wall: number) {
  const share = (duration: number) => `${Math.round((duration * 100) / wall)}%`;
  const rest = wall - spent.waited - spent.http - spent.consumer;
  return `waited ${share(spent.waited)}, http ${share(spent.http)}, consumer ${share(spent.consumer)} (extract ${share(spent.extract)}), other ${share(rest)}`;
}

// Got's phases of a request. On a socket that the pool reuses, Got sets lookup
// and connect to the socket time and copies the first connection's dns, tcp
// and tls phases (got/dist/source/core/utils/timer.js), so they are not this
// request's.
function phases(timings: Answered['timings']) {
  if (timings === null) return '[-]';
  const { socket, lookup, connect } = timings;
  const { dns, tcp, tls, firstByte, download } = timings.phases;
  const connection =
    socket !== undefined && lookup === socket && connect === socket
      ? 'reused'
      : `dns ${milliseconds(dns)} tcp ${milliseconds(tcp)} tls ${milliseconds(tls)}`;
  return `[${connection} first ${milliseconds(firstByte)} download ${milliseconds(download)}]`;
}

function time() {
  return new Date().toISOString();
}

function milliseconds(value: number | undefined) {
  return value === undefined ? '-' : `${Math.round(value)}ms`;
}
