import { validate } from '@sdk-it/hono/runtime';
import type { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';

import { collectionSchema } from '../collection.ts';
import crawl from '../crawl.ts';
import { candidates } from '../items.ts';
import queue, { searches } from '../queue.ts';
import store, { type Crawled } from '../store.ts';
import { sql } from '../warehouse.ts';

const shape = collectionSchema.shape;

// The pages that the crawl stored, by the starting URL that led to them.
function storedInputs(): ReadonlySet<string> {
  try {
    return new Set(
      sql.all`SELECT DISTINCT inputUrl FROM stored_pages`.map(
        (row) => z.object({ inputUrl: z.string() }).parse(row).inputUrl,
      ),
    );
  } catch (error) {
    if (Error.isError(error) && /^no such table/u.test(error.message)) {
      return new Set();
    }
    throw error;
  }
}

// A collection with how far it is: its search, each page that its search
// found (read, failed with the reason of its last visit, or pending), its
// pages and items, and its evaluations.
function collectionResource(collection: Crawled) {
  const { seeds: _, searched, ...definition } = collection;
  const pages = candidates(collection);
  const evaluations = pages.flatMap(({ evaluations: given }) => given);
  const read = storedInputs();
  const failures = store.failures();
  return {
    ...definition,
    progress: {
      search: searched,
      seeds: store.seeds(collection.id).map(({ url, rank }) => {
        const failure = failures.get(url);
        return {
          url,
          rank,
          crawl: read.has(url)
            ? { state: 'read' }
            : failure === undefined
              ? { state: 'pending' }
              : { state: 'failed', ...failure },
        };
      }),
      pages: pages.length,
      items: pages.filter(({ matches }) => matches).length,
      evaluations: {
        judged: evaluations.filter(({ state }) => state === 'judged').length,
        failed: evaluations.filter(({ state }) => state === 'failed').length,
        pending: evaluations.filter(({ state }) => state === 'pending').length,
      },
    },
  };
}

function found(id: string): Crawled {
  const collection = store.crawled().find((given) => given.id === id);
  if (collection === undefined) {
    throw new HTTPException(404, {
      message: 'No such collection',
      cause: { code: 'not_found' },
    });
  }
  return collection;
}

// The crawl builds its pipeline again for a new or deleted collection,
// which elt cannot do while a pass runs (elt #3679).
function refuseWhilePassing() {
  if (crawl.passing) {
    throw new HTTPException(409, {
      message: 'A crawl is running; change the collections once it ends',
      cause: { code: 'crawl_running' },
    });
  }
}

export default function (router: Hono) {
  router.post(
    '/v1/collections',
    validate((payload) => ({
      title: { select: payload.body.title, against: shape.title },
      search: { select: payload.body.search, against: shape.search },
      criteria: { select: payload.body.criteria, against: shape.criteria },
      pages: { select: payload.body.pages, against: shape.pages },
      lists: { select: payload.body.lists, against: shape.lists },
      fields: { select: payload.body.fields, against: shape.fields },
      monitor: { select: payload.body.monitor, against: shape.monitor },
    })),
    async (c) => {
      const definition = collectionSchema.safeParse(c.var.input);
      if (!definition.success) {
        throw new HTTPException(400, {
          message: definition.error.issues
            .map(({ message }) => message)
            .join('; '),
          cause: { code: 'invalid_argument' },
        });
      }
      refuseWhilePassing();
      const collection = store.addCollection(definition.data);
      const { monitor } = definition.data;
      if (monitor !== undefined) {
        try {
          await queue.schedule(
            searches,
            monitor.cron,
            { collection: collection.id },
            { key: collection.id },
          );
        } catch (error) {
          store.deleteCollection(collection.id);
          throw new HTTPException(400, {
            message: `The monitor's cron is not valid: ${Error.isError(error) ? error.message : String(error)}`,
            cause: { code: 'invalid_argument' },
          });
        }
      }
      if (definition.data.search !== undefined) {
        await queue.send(searches, { collection: collection.id });
      }
      crawl.rebuild();
      return c.json(collectionResource(found(collection.id)), 201, {
        Location: `/v1/collections/${collection.id}`,
      });
    },
  );

  router.get('/v1/collections', (c) =>
    c.json({ data: store.crawled().map(collectionResource) }),
  );

  router.get('/v1/collections/:id', (c) =>
    c.json(collectionResource(found(c.req.param('id')))),
  );

  router.delete('/v1/collections/:id', async (c) => {
    const { id } = found(c.req.param('id'));
    refuseWhilePassing();
    await queue.unschedule(searches, id);
    store.deleteCollection(id);
    crawl.rebuild();
    return c.body(null, 204);
  });
}
