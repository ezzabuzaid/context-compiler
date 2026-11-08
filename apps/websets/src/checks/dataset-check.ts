import type { Found } from '../search.ts';
import { searchFor } from '../searching.ts';
import store, { type Dataset } from '../store.ts';
import { Check, type Read } from './check.ts';

// A dataset's search, run again with its query and criteria: the pages that
// it finds become the dataset's pages, which the crawl reads in its next
// pass, as Exa's monitors add what their searches find to a webset. A change
// is the pages that the dataset did not have. The dataset's pages are the
// baseline, so its first run reports too.
export class DatasetCheck extends Check<readonly Found[]> {
  readonly #dataset: Dataset;
  readonly #search: NonNullable<Dataset['search']>;

  constructor(
    monitor: string,
    dataset: Dataset,
    search: NonNullable<Dataset['search']>,
  ) {
    super(monitor);
    this.#dataset = dataset;
    this.#search = search;
  }

  protected read(signal: AbortSignal): Promise<Read<readonly Found[]>> {
    return searchFor(this.#dataset, this.#search, signal);
  }

  protected record(found: readonly Found[]) {
    const id = this.#dataset.id;
    const before = new Set(store.seeds(id).map(({ url }) => url));
    store.searched(id, found);
    const fresh = found.map(({ url }) => url).filter((url) => !before.has(url));
    return fresh.length === 0
      ? null
      : { type: 'search.found' as const, data: { urls: fresh } };
  }
}
