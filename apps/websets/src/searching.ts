import { z } from 'zod';

import crawl from './crawl.ts';
import { search } from './search.ts';
import store from './store.ts';

const jobSchema = z.object({ dataset: z.string() });

const reasonOf = (error: unknown) =>
  Error.isError(error) ? error.message : String(error);

// One search of a dataset: the pages that it finds become the
// dataset's seeds, and the crawl reads them once the pipeline is built
// again. A failed search keeps its reason, and the job ends, as a later
// monitor run searches again. While a pass runs, the watch builds the
// pipeline again after the pass.
export async function runSearch(data: unknown, signal: AbortSignal) {
  const { dataset: id } = jobSchema.parse(data);
  const dataset = store.dataset(id);
  if (dataset?.search === undefined) {
    return;
  }
  store.searching(id);
  try {
    store.searched(
      id,
      await search(
        {
          ...dataset.search,
          criteria: dataset.criteria.map(({ description }) => description),
        },
        signal,
      ),
    );
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }
    store.searchFailed(id, reasonOf(error));
    console.log(`could not search for ${id}: ${reasonOf(error)}`);
  }
  if (!crawl.passing) {
    crawl.rebuild();
  }
}
