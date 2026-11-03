import type { Hono } from 'hono';
import { z } from 'zod';

import { rows } from '../alerts/alert.ts';
import { lists } from '../pipeline.ts';
import { currentAsOf, programResources } from '../programs.ts';
import { seedResources } from '../seeds.ts';
import warehouse from '../warehouse.ts';

export default function (router: Hono) {
  // What the crawl covers, so a consumer sees what it cannot know: the lists
  // that seed it, the pages it stored and the programs among them, and each
  // page that a query's search found, read, failed or pending.
  router.get('/v1/coverage', (c) => {
    const [stored] = rows(
      () =>
        warehouse.sql
          .all`SELECT COUNT(DISTINCT articleUrl) AS pages FROM stored_pages`,
    );
    return c.json({
      lists,
      pages:
        stored === undefined
          ? 0
          : z.object({ pages: z.number() }).parse(stored).pages,
      programs: programResources().length,
      seeds: seedResources(),
      currentAsOf: currentAsOf(),
    });
  });
}
