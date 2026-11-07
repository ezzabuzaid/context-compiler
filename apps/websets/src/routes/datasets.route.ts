import { validate } from '@sdk-it/hono/runtime';
import type { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';

import crawl from '../crawl.ts';
import * as inputs from '../inputs.ts';
import { candidates } from '../items.ts';
import queue, { searches } from '../queue.ts';
import store, { type Crawled } from '../store.ts';
import { sql } from '../warehouse.ts';

const storedPageRow = z.object({ inputUrl: z.string() });

// The pages that the crawl stored, by the starting URL that led to them.
function storedInputs(): ReadonlySet<string> {
  try {
    return new Set(
      sql.all`SELECT DISTINCT inputUrl FROM stored_pages`.map(
        (row) => storedPageRow.parse(row).inputUrl,
      ),
    );
  } catch (error) {
    if (Error.isError(error) && /^no such table/u.test(error.message)) {
      return new Set();
    }
    throw error;
  }
}

// How the crawl went for a page that a search found: read, failed with the
// reason of its last visit, or pending.
type SeedCrawl =
  | { readonly state: 'read' | 'pending' }
  | {
      readonly state: 'failed';
      readonly reason: string;
      readonly failedAt: string;
    };

// A dataset with how far it is: its search, each page that its search
// found, its pages and items, and its evaluations.
function datasetResource(dataset: Crawled) {
  const { seeds: _, searched, ...definition } = dataset;
  const pages = candidates(dataset);
  const evaluations = pages.flatMap(({ evaluations: given }) => given);
  const read = storedInputs();
  const failures = store.failures();
  const crawlOf = (url: string): SeedCrawl => {
    if (read.has(url)) {
      return { state: 'read' };
    }
    const failure = failures.get(url);
    return failure === undefined
      ? { state: 'pending' }
      : { state: 'failed', ...failure };
  };
  return {
    ...definition,
    progress: {
      search: searched,
      seeds: store
        .seeds(dataset.id)
        .map(({ url, rank }) => ({ url, rank, crawl: crawlOf(url) })),
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
  const dataset = store.crawled().find((given) => given.id === id);
  if (dataset === undefined) {
    throw new HTTPException(404, {
      message: 'No such dataset',
      cause: { code: 'not_found' },
    });
  }
  return dataset;
}

// The crawl builds its pipeline again for a new or deleted dataset,
// which elt cannot do while a pass runs (elt #3679).
function refuseWhilePassing() {
  if (crawl.passing) {
    throw new HTTPException(409, {
      message: 'A crawl is running; change the datasets once it ends',
      cause: { code: 'crawl_running' },
    });
  }
}

export default function (router: Hono) {
  /**
   * @openapi createDataset
   * @summary Create a dataset
   * @tags datasets
   * @description Keep a new dataset current: the pages that meet every criterion, found by its search, given as pages or linked from its lists, each with its fields. Answers with the dataset and its progress; the search, the crawl and the judging run in the background.
   */
  router.post(
    '/v1/datasets',
    validate((payload) => ({
      title: {
        select: payload.body.title,
        against: z.string().trim().min(1).max(200),
      },
      search: {
        select: payload.body.search,
        against: z
          .object({
            query: inputs.searchQuery,
            count: z.number().int().min(1).max(50).default(10),
          })
          .optional(),
      },
      criteria: {
        select: payload.body.criteria,
        against: z
          .array(z.object({ description: inputs.description }))
          .min(1)
          .max(5),
      },
      pages: {
        select: payload.body.pages,
        against: z.array(inputs.webUrl).max(1000).default([]),
      },
      lists: {
        select: payload.body.lists,
        against: z.array(inputs.webUrl).max(100).default([]),
      },
      fields: {
        select: payload.body.fields,
        against: z
          .array(inputs.field)
          .max(10)
          .default([])
          .refine(
            (fields) =>
              new Set(fields.map(({ name }) => name)).size === fields.length,
            { error: 'Each field needs its own name' },
          ),
      },
      monitor: {
        select: payload.body.monitor,
        against: z
          .object({ cron: z.string().trim().min(9).max(100) })
          .optional(),
      },
    })),
    async (c) => {
      const definition = c.var.input;
      const { search, pages, lists, monitor } = definition;
      if (search === undefined && pages.length === 0 && lists.length === 0) {
        throw new HTTPException(400, {
          message: 'A dataset needs a search, pages or lists',
          cause: { code: 'invalid_argument' },
        });
      }
      if (monitor !== undefined && search === undefined) {
        throw new HTTPException(400, {
          message: 'A monitor searches again, so it needs a search',
          cause: { code: 'invalid_argument' },
        });
      }
      refuseWhilePassing();
      const dataset = store.addDataset(definition);
      if (monitor !== undefined) {
        try {
          await queue.schedule(
            searches,
            monitor.cron,
            { dataset: dataset.id },
            { key: dataset.id },
          );
        } catch (error) {
          store.deleteDataset(dataset.id);
          throw new HTTPException(400, {
            message: `The monitor's cron is not valid: ${Error.isError(error) ? error.message : String(error)}`,
            cause: { code: 'invalid_argument' },
          });
        }
      }
      if (search !== undefined) {
        await queue.send(searches, { dataset: dataset.id });
      }
      crawl.rebuild();
      return c.json(datasetResource(found(dataset.id)), 201, {
        Location: `/v1/datasets/${dataset.id}`,
      });
    },
  );

  /**
   * @openapi listDatasets
   * @summary List datasets
   * @tags datasets
   * @description The datasets, oldest first, each with its progress.
   */
  router.get(
    '/v1/datasets',
    validate(() => ({})),
    (c) => {
      return c.json({ data: store.crawled().map(datasetResource) });
    },
  );

  /**
   * @openapi getDataset
   * @summary Get a dataset
   * @tags datasets
   * @description A dataset with its progress: its search, each page that its search found, its pages, items and evaluations.
   */
  router.get(
    '/v1/datasets/:id',
    validate((payload) => ({
      id: { select: payload.params.id, against: z.string() },
    })),
    (c) => {
      return c.json(datasetResource(found(c.var.input.id)));
    },
  );

  /**
   * @openapi deleteDataset
   * @summary Delete a dataset
   * @tags datasets
   * @description Stop keeping a dataset current. Its events stay in the log.
   */
  router.delete(
    '/v1/datasets/:id',
    validate((payload) => ({
      id: { select: payload.params.id, against: z.string() },
    })),
    async (c) => {
      const { id } = found(c.var.input.id);
      refuseWhilePassing();
      await queue.unschedule(searches, id);
      store.deleteDataset(id);
      crawl.rebuild();
      return c.body(null, 204);
    },
  );
}
