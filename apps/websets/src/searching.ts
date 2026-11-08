import { z } from 'zod';

import type { Read } from './checks/check.ts';
import { type Found, search } from './search.ts';
import store, { type Dataset } from './store.ts';

const jobSchema = z.object({ dataset: z.string() });

const reasonOf = (error: unknown) =>
  Error.isError(error) ? error.message : String(error);

// Searches the web for a dataset's pages with its query and criteria, and
// keeps how the search went in the dataset's progress: pending while it runs,
// and failed with its reason. The caller keeps the pages that it found.
export async function searchFor(
  dataset: Dataset,
  { query, count }: NonNullable<Dataset['search']>,
  signal: AbortSignal,
): Promise<Read<readonly Found[]>> {
  store.searching(dataset.id);
  try {
    return {
      value: await search(
        {
          query,
          count,
          criteria: dataset.criteria.map(({ description }) => description),
        },
        signal,
      ),
    };
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }
    store.searchFailed(dataset.id, reasonOf(error));
    console.log(`could not search for ${dataset.id}: ${reasonOf(error)}`);
    return { failure: reasonOf(error) };
  }
}

// The search of a new dataset: the pages that it finds become the dataset's
// seeds, and the crawl reads them in its next pass. A failed search keeps
// its reason, and the job ends, as a monitor of the dataset searches again.
export async function runSearch(data: unknown, signal: AbortSignal) {
  const { dataset: id } = jobSchema.parse(data);
  const dataset = store.dataset(id);
  if (dataset?.search === undefined) {
    return;
  }
  const searched = await searchFor(dataset, dataset.search, signal);
  if ('value' in searched) {
    store.searched(id, searched.value);
  }
}
