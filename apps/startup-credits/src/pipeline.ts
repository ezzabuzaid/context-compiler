import { join } from 'node:path';

import { Connection, Copy, Pipeline } from '@workspace/elt';
import {
  ComputedDataset,
  SQLiteCheckpointStore,
  SQLiteDestination,
  SQLiteSyncHistory,
  View,
} from '@workspace/elt-sqlite';
import {
  AdaptiveRevisit,
  CompositeRevisit,
  FixedRevisit,
  PaginationReader,
  hour,
} from '@workspace/sdk-web-crawler';
import { ArticleExtractor } from '@workspace/source-web-pages/article-extractor';
import { WebSource } from '@workspace/source-web-pages/web-source';
import { WebStream } from '@workspace/source-web-pages/web-stream';

import directory from './directory.ts';
import { PageKinds } from './page-kinds.ts';
import { ProgramOffers } from './program-offers.ts';

// GitHub lists of startup credit programs; the second links most programs'
// own pages, the first links more companies (#3352).
const lists = [
  'https://github.com/avinash201199/awesome-startup-credits',
  'https://github.com/doanbactam/awesome-builder-programs',
];

const destination = new SQLiteDestination({
  path: join(directory, 'credits.sqlite'),
});

const source = new WebSource({
  streams: [
    {
      stream: new WebStream({
        name: 'program_pages',
        primaryKey: ['articleUrl'],
        // Each list hands back the pages it links on every website.
        readers: [new PaginationReader({ strategy: 'all' })],
        // Lists every hour; pages when they change, as AdaptiveRevisit learns.
        revisit: new CompositeRevisit(
          lists.map((list) => [
            new URLPattern(list),
            new FixedRevisit({ every: hour }),
          ]),
          new AdaptiveRevisit(),
        ),
        // Every host but GitHub's, so a list's license and commits are not pages
        // (the crawler recipe "Follow a list to other websites").
        include: [new URLPattern({ hostname: '((?!github\\.com$).*)' })],
        extractor: new ArticleExtractor(),
      }),
      inputs: lists,
    },
  ],
  // The crawler's name, which robots.txt groups match (RFC 9309).
  userAgent:
    'StartupCredits/0.1 (+https://github.com/ezzabuzaid/context-compiler)',
  cachePath: join(directory, 'web-http.sqlite'),
});
const pages = destination.table('program_pages');
// Only the pages labelled program go to the offer model.
const programs = new View({
  into: destination,
  name: 'programs',
  description: 'The stored pages that Jev labels program.',
  columns: {
    articleUrl: 'The article URL of the program page.',
    title: 'The title of the page, or NULL.',
    textContent: 'The text of the page.',
  },
  sql: "SELECT p.articleUrl, p.title, p.textContent FROM program_pages p JOIN page_kinds k USING (articleUrl) WHERE k.status = 'computed' AND k.kind = 'program'",
});

export default new Pipeline({
  // One process runs the passes, so a pass left running belongs to one that
  // stopped.
  history: new SQLiteSyncHistory({ soleWriter: true }),
  connections: [
    new Connection({
      name: 'lists',
      source,
      destination,
      checkpoints: new SQLiteCheckpointStore({
        path: join(directory, 'checkpoints.sqlite'),
      }),
      steps: [
        new Copy((await source.discover()).get('program_pages'), pages, {
          id: 'lists:program_pages',
          syncMode: 'incremental',
          destinationSyncMode: 'append_dedup',
        }),
      ],
    }),
  ],
  derived: [
    new ComputedDataset({
      into: destination,
      name: 'page_kinds',
      description: 'The kind of each stored page, as Jev 1.14 labels it.',
      from: [pages],
      compute: new PageKinds(),
    }),
    programs,
    new ComputedDataset({
      into: destination,
      name: 'program_offers',
      description: 'The offers that each program page states.',
      from: [programs],
      compute: new ProgramOffers(),
    }),
  ],
});
