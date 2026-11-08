import { validate } from '@sdk-it/hono/runtime';
import type { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';

import { callFailures } from '../call-failure.ts';
import * as inputs from '../inputs.ts';
import { search } from '../search.ts';

export default function (router: Hono) {
  /**
   * @openapi search
   * @summary Search the web
   * @tags search
   * @description The pages that a web search finds for a query, best first, as GPT-6-Luna searches with OpenAI's web_search tool. Nothing is stored, and the call waits for the search, about 15 seconds.
   */
  router.get(
    '/v1/search',
    validate((payload) => ({
      query: { select: payload.query.query, against: inputs.searchQuery },
      count: {
        select: payload.query.count,
        against: z.coerce.number().int().min(1).max(50).default(10),
      },
    })),
    async (c) => {
      const { query, count } = c.var.input;
      let found;
      try {
        found = await search({ query, count, criteria: [] }, c.req.raw.signal);
      } catch (error) {
        // The web search is an upstream: its failure is a bad gateway.
        throw new HTTPException(502, {
          message: `The web search failed: ${callFailures.reason(error)}`,
          cause: { code: 'search_failed' },
        });
      }
      return c.json({
        results: found.map(({ url }, index) => ({ position: index + 1, url })),
      });
    },
  );
}
