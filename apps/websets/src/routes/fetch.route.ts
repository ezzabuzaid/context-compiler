import { validate } from '@sdk-it/hono/runtime';
import type { Hono } from 'hono';
import { z } from 'zod';

import {
  type Article,
  ArticleError,
  HTMLExtraction,
  MarkdownExtraction,
  WebArticle,
} from '@eltjs/sdk-web-article';

import * as inputs from '../inputs.ts';
import client from '../web-client.ts';

// A page's article, asked for in Markdown first, through the crawl's own
// client: one cache and one record of each website.
const reader = new WebArticle(
  [new MarkdownExtraction(), new HTMLExtraction()],
  client.http,
);

// How one page went: its article, or why it could not be read.
type Read =
  | { readonly url: string; readonly article: Article }
  | { readonly url: string; readonly reason: string };

export default function (router: Hono) {
  /**
   * @openapi fetch
   * @summary Read pages now
   * @tags fetch
   * @description The article of each page, read now with the crawl's rules: the website's robots.txt, its delay, the crawler's name and the HTTP cache. Nothing else is stored. A page that cannot be read, such as a 403 or a page that robots.txt disallows, is an error with its reason.
   */
  router.post(
    '/v1/fetch',
    validate((payload) => ({
      urls: {
        select: payload.body.urls,
        against: z.array(inputs.webUrl).min(1).max(10),
      },
    })),
    async (c) => {
      const signal = c.req.raw.signal;
      const read = await Promise.all(
        c.var.input.urls.map(async (url): Promise<Read> => {
          try {
            const article = await reader.fetch(url, signal);
            return article === null
              ? { url, reason: 'The page has no article' }
              : { url, article };
          } catch (error) {
            if (!(error instanceof ArticleError)) {
              throw error;
            }
            return {
              url,
              reason: Error.isError(error.cause)
                ? error.cause.message
                : error.message,
            };
          }
        }),
      );
      await client.save();
      const fetchedAt = new Date().toISOString();
      return c.json({
        results: read.flatMap((page) =>
          'article' in page
            ? [
                {
                  url: page.url,
                  finalUrl: page.article.url,
                  title: page.article.title,
                  text: page.article.textContent,
                  markdown: page.article.markdown,
                  fetchedAt,
                },
              ]
            : [],
        ),
        errors: read.flatMap((page) =>
          'reason' in page ? [{ url: page.url, reason: page.reason }] : [],
        ),
      });
    },
  );
}
