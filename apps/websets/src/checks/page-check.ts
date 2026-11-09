import { FILE_HEADERS_ONLY, createPatch } from 'diff';

import {
  ArticleError,
  HTMLExtraction,
  MarkdownExtraction,
  WebArticle,
} from '@eltjs/sdk-web-article';

import store from '../store.ts';
import client from '../web-client.ts';
import { Check, type Read } from './check.ts';

// A page's article, asked for in Markdown first, through the crawl's own
// client, as routes/fetch.route.ts reads one (docs/copied-code.md).
const reader = new WebArticle(
  [new MarkdownExtraction(), new HTMLExtraction()],
  client.http,
);

type Text = { readonly text: string; readonly readAt: string };

// A page whose extracted text the monitor compares, line by line. A change is
// a unified diff, as GNU diff -u writes one, with the time that each text was
// read in its file header, as changedetection.io and TinyFish report what
// changed on a page. The first run reads the baseline.
export class PageCheck extends Check<Text> {
  readonly #url: string;

  constructor(monitor: string, url: string) {
    super(monitor);
    this.#url = url;
  }

  protected async read(signal: AbortSignal): Promise<Read<Text>> {
    try {
      const article = await reader.fetch(this.#url, signal);
      return article === null
        ? { failure: 'The page has no article' }
        : {
            value: {
              text: article.textContent,
              readAt: new Date().toISOString(),
            },
          };
    } catch (error) {
      if (!(error instanceof ArticleError)) {
        throw error;
      }
      return {
        failure: Error.isError(error.cause)
          ? error.cause.message
          : error.message,
      };
    } finally {
      await client.save();
    }
  }

  protected record(read: Text) {
    const before = store.snapshot(this.monitor);
    store.saveSnapshot(this.monitor, read);
    if (before === undefined || before.text === read.text) {
      return null;
    }
    return {
      type: 'page.changed' as const,
      data: {
        url: this.#url,
        // Each text ends its last line, so the diff has no "No newline at
        // end of file" marker.
        diff: createPatch(
          this.#url,
          `${before.text}\n`,
          `${read.text}\n`,
          before.readAt,
          read.readAt,
          { context: 3, headerOptions: FILE_HEADERS_ONLY },
        ),
      },
    };
  }
}
