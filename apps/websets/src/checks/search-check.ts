import { callFailures } from '../call-failure.ts';
import { type Found, search } from '../search.ts';
import store from '../store.ts';
import { Check, type Read } from './check.ts';

// A web search for a query, as GET /v1/search runs one. A change is the
// pages that no run of the monitor found before, best first: each page is
// compared with all the earlier runs, as changedetection.io compares unique
// lines with a watch's whole history and Exa's monitors skip what a webset
// holds, so a page that leaves the results and comes back is not new. The
// first run reads the baseline.
export class SearchCheck extends Check<readonly Found[]> {
  readonly #query: string;
  readonly #count: number;

  constructor(
    monitor: string,
    { query, count }: { readonly query: string; readonly count: number },
  ) {
    super(monitor);
    this.#query = query;
    this.#count = count;
  }

  protected async read(signal: AbortSignal): Promise<Read<readonly Found[]>> {
    try {
      const found = await search(
        { query: this.#query, count: this.#count, criteria: [] },
        signal,
      );
      return { value: found };
    } catch (error) {
      return { failure: callFailures.reason(error) };
    }
  }

  protected record(found: readonly Found[]) {
    const before = store.sighted(this.monitor);
    const urls = found.map(({ url }) => url);
    store.saveSighted(this.monitor, [...new Set([...(before ?? []), ...urls])]);
    if (before === undefined) {
      return null;
    }
    const seen = new Set(before);
    const fresh = urls.filter((url) => !seen.has(url));
    return fresh.length === 0
      ? null
      : { type: 'search.found' as const, data: { urls: fresh } };
  }
}
