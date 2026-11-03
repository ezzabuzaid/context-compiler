import { validate } from '@sdk-it/hono/runtime';
import type { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';

import crawl from '../crawl.ts';
import { seedResources } from '../seeds.ts';
import store, { type Query, criterionSchema } from '../store.ts';
import { items } from '../verdicts.ts';

// One to ten criteria, each with its own name, as Parallel's FindAll takes
// match conditions.
const criteriaSchema = z
  .array(criterionSchema)
  .min(1)
  .max(10)
  .refine(
    (criteria) =>
      new Set(criteria.map(({ name }) => name)).size === criteria.length,
    { error: 'Each criterion needs its own name' },
  );

// A query with what its search found and how far the judging is: each
// program has one verdict for each criterion.
function queryResource(query: Query) {
  const verdicts = items(query).flatMap(({ verdicts: given }) => given);
  return {
    ...query,
    seeds: seedResources(query.id),
    judging: {
      judged: verdicts.filter(({ state }) => state === 'judged').length,
      failed: verdicts.filter(({ state }) => state === 'failed').length,
      pending: verdicts.filter(({ state }) => state === 'pending').length,
    },
  };
}

function found(queryId: string): Query {
  const query = store.query(queryId);
  if (query === undefined) {
    throw new HTTPException(404, {
      message: 'No such query',
      cause: { code: 'not_found' },
    });
  }
  return query;
}

// The crawl builds its pipeline again for a new or deleted query, which
// elt cannot do while a pass runs (elt #3679).
function refuseWhilePassing() {
  if (crawl.passing) {
    throw new HTTPException(409, {
      message: 'A crawl is running; change the queries once it ends',
      cause: { code: 'crawl_running' },
    });
  }
}

export default function (router: Hono) {
  // A standing query: its search runs, the crawl reads the pages it finds,
  // and the model judges every program against each criterion as the
  // crawl stores it, now and later.
  router.post(
    '/v1/queries',
    validate((payload) => ({
      criteria: { select: payload.body.criteria, against: criteriaSchema },
    })),
    (c) => {
      refuseWhilePassing();
      const query = store.addQuery(c.var.input.criteria);
      crawl.rebuild();
      return c.json(queryResource(query), 202, {
        Location: `/v1/queries/${query.id}`,
      });
    },
  );

  router.get('/v1/queries', (c) =>
    c.json({ queries: store.queries().map(queryResource) }),
  );

  router.get('/v1/queries/:id', (c) =>
    c.json(queryResource(found(c.req.param('id')))),
  );

  // The programs that meet every criterion, each with its verdicts.
  router.get('/v1/queries/:id/items', (c) =>
    c.json({
      items: items(found(c.req.param('id')))
        .filter(({ matches }) => matches)
        .map(({ program, verdicts }) => ({ program, verdicts })),
    }),
  );

  router.delete('/v1/queries/:id', (c) => {
    refuseWhilePassing();
    store.deleteQuery(found(c.req.param('id')).id);
    crawl.rebuild();
    return c.body(null, 204);
  });
}
