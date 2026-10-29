import { join } from 'node:path';

import { Connection, Copy, Pipeline } from '@workspace/elt';
import {
  SQLiteCheckpointStore,
  SQLiteDestination,
  SQLiteSyncHistory,
} from '@workspace/elt-sqlite';
import {
  AdaptiveRevisit,
  CompositeRevisit,
  FixedRevisit,
  LinkReader,
  type Reader,
  hour,
} from '@workspace/sdk-web-crawler';
import { ArticleExtractor } from '@workspace/source-web-pages/article-extractor';
import { WebSource } from '@workspace/source-web-pages/web-source';
import { WebStream } from '@workspace/source-web-pages/web-stream';

import directory from './directory.ts';
import { NewestFeedItems } from './newest-feed-items.ts';
import { Reports } from './reports.ts';
import type { Source } from './sources.ts';

// The crawler's name, which robots.txt groups match (RFC 9309).
const userAgent =
  'WhatIsGoingOn/0.1 (+https://github.com/ezzabuzaid/what-is-going-on)';

const destination = new SQLiteDestination({
  path: join(directory, 'articles.sqlite'),
});
// One server runs the passes, so a pass left running belongs to a server
// that stopped.
const history = new SQLiteSyncHistory({ soleWriter: true });
const checkpoints = new SQLiteCheckpointStore({
  path: join(directory, 'checkpoints.sqlite'),
});

// A source with a feed is read through its newest feed items. A source
// without one is read through the posts its blog page links to: links under
// the source's posts address, one hop, so a first crawl reads what the page
// shows and never the site's sitemaps or archive. Starting pages are read
// again every hour; posts when they change, as AdaptiveRevisit learns.
async function connection(
  name: 'feeds' | 'blogs',
  inputs: readonly string[],
  readers: readonly Reader<unknown, unknown>[],
  include: readonly URLPattern[] | undefined,
) {
  const source = new WebSource({
    stream: new WebStream({
      name: `${name}_articles`,
      primaryKey: ['articleUrl'],
      readers,
      revisit: new CompositeRevisit(
        inputs.map((input) => [
          new URLPattern(input),
          new FixedRevisit({ every: hour }),
        ]),
        new AdaptiveRevisit(),
      ),
      include,
      extractor: new ArticleExtractor(),
    }),
    inputs,
    userAgent,
    cachePath: join(directory, 'web-http.sqlite'),
  });
  return new Connection({
    name,
    source,
    destination,
    checkpoints,
    steps: (await source.discover()).streams.map(
      (stream) =>
        new Copy(stream, destination.table(stream.name), {
          id: `${name}:articles`,
          syncMode: 'incremental',
          destinationSyncMode: 'append_dedup',
        }),
    ),
  });
}

export default async function pipeline(options: {
  sources: readonly Source[];
  // The OpenAI-compatible URL of the EmbeddingGemma 2 server.
  embeddings: string;
}) {
  const feeds = options.sources.flatMap(({ feed }) => feed ?? []);
  const blogs = options.sources.filter(({ feed }) => feed === null);
  return new Pipeline({
    history,
    connections: [
      ...(feeds.length === 0
        ? []
        : [
            await connection(
              'feeds',
              feeds,
              [new NewestFeedItems()],
              undefined,
            ),
          ]),
      ...(blogs.length === 0
        ? []
        : [
            await connection(
              'blogs',
              blogs.map(({ site }) => site),
              [new LinkReader({ maxDepth: 0, maxPages: 0 })],
              blogs.map(({ posts }) => {
                const { protocol, hostname, pathname } = new URL(posts);
                return new URLPattern({
                  protocol: protocol.slice(0, -1),
                  hostname,
                  pathname: `${pathname.replace(/\/$/, '')}/*`,
                });
              }),
            ),
          ]),
    ],
    derived: [
      new Reports({
        path: join(directory, 'app.sqlite'),
        sources: options.sources,
        embeddings: options.embeddings,
      }),
    ],
  });
}
