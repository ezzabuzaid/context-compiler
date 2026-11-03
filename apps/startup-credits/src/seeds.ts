import { z } from 'zod';

import { rows } from './alerts/alert.ts';
import store from './store.ts';
import warehouse from './warehouse.ts';

// A page that a query's search found, and whether the crawl read it: read
// once the warehouse stores it, failed with the reason of its last visit,
// such as a bot challenge, or pending until the crawl reaches it.
type SeedResource = {
  readonly url: string;
  readonly company: string;
  readonly rank: number;
  readonly crawl:
    | { readonly state: 'read' }
    | {
        readonly state: 'failed';
        readonly reason: string;
        readonly failedAt: string;
      }
    | { readonly state: 'pending' };
};

export function seedResources(queryId?: string): readonly SeedResource[] {
  const read = new Set(
    rows(
      () => warehouse.sql.all`SELECT DISTINCT inputUrl FROM search_pages`,
    ).map((row) => z.object({ inputUrl: z.string() }).parse(row).inputUrl),
  );
  const failures = store.failures();
  return store.seeds(queryId).map(({ url, company, rank }) => {
    const failure = failures.get(url);
    return {
      url,
      company,
      rank,
      crawl: read.has(url)
        ? { state: 'read' }
        : failure === undefined
          ? { state: 'pending' }
          : { state: 'failed', ...failure },
    };
  });
}
