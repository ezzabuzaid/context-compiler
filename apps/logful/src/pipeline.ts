import { join } from 'node:path';

import { Connection, Copy, Pipeline } from '@eltjs/elt';
import {
  SQLiteCheckpointStore,
  SQLiteDestination,
  SQLiteSyncHistory,
} from '@eltjs/elt-sqlite';
import { ListingReader, PaginationReader } from '@eltjs/sdk-web-crawler';
import { ArticleExtractor } from '@eltjs/source-web-pages/article-extractor';
import { WebSource } from '@eltjs/source-web-pages/web-source';
import { WebStream } from '@eltjs/source-web-pages/web-stream';
import { dataFolder } from '@workspace/data-folder';

const directory = await dataFolder('logful', process.env);

// The news of anthropic.com: the /news list and the sitemap that its
// robots.txt names, which lists every post.
const source = new WebSource({
  streams: [
    {
      stream: new WebStream({
        name: 'news',
        primaryKey: ['articleUrl'],
        readers: [new ListingReader(), new PaginationReader()],
        include: [new URLPattern('https://www.anthropic.com/news/*')],
        extractor: new ArticleExtractor(),
      }),
      inputs: ['https://www.anthropic.com/news'],
    },
  ],
  // The crawler's name, which robots.txt groups match (RFC 9309).
  userAgent: 'Logful/0.1 (+https://github.com/ezzabuzaid/context-compiler)',
  cachePath: join(directory, 'web-http.sqlite'),
});
const destination = new SQLiteDestination({
  path: join(directory, 'news.sqlite'),
});

export default new Pipeline({
  clock: globalThis,
  history: new SQLiteSyncHistory({ soleWriter: true }),
  connections: [
    new Connection({
      name: 'anthropic',
      source,
      destination,
      checkpoints: new SQLiteCheckpointStore({
        path: join(directory, 'checkpoints.sqlite'),
      }),
      steps: [
        new Copy(
          (await source.discover()).get('news'),
          destination.table('news'),
          {
            id: 'anthropic:news',
            syncMode: 'incremental',
            destinationSyncMode: 'append_dedup',
          },
        ),
      ],
    }),
  ],
});
