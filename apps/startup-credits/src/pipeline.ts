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
  LinkReader,
  ListingReader,
  PaginationReader,
  hour,
} from '@workspace/sdk-web-crawler';
import { ArticleExtractor } from '@workspace/source-web-pages/article-extractor';
import { WebSource } from '@workspace/source-web-pages/web-source';
import { WebStream } from '@workspace/source-web-pages/web-stream';

import directory from './directory.ts';
import { PageKinds } from './rules/page-kinds.ts';
import { ProgramOffers } from './rules/program-offers.ts';

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
        // Each list hands back the pages it links on every website. A linked
        // page on another website is searched one step, its links and its
        // robots.txt sitemaps, for the pages that expand matches (the crawler
        // recipe "Search inside the sites a list links").
        readers: [
          new PaginationReader({ strategy: 'all' }),
          new ListingReader(),
          new LinkReader({ maxDepth: 0, maxPages: 0 }),
        ],
        expand: [
          new URLPattern({ pathname: '*startup*' }),
          new URLPattern({ pathname: '*start-up*' }),
        ],
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
const catalog = await source.discover();
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
        new Copy(catalog.get('program_pages'), pages, {
          id: 'lists:program_pages',
          syncMode: 'incremental',
          destinationSyncMode: 'append_dedup',
        }),
        // Every route by which the crawl found a page: the alerts follow
        // them from each link of a list to the pages that it led to.
        new Copy(
          catalog.get('program_pages_routes'),
          destination.table('program_pages_routes'),
          {
            id: 'lists:program_pages_routes',
            syncMode: 'incremental',
            destinationSyncMode: 'append_dedup',
          },
        ),
        // Whether the crawl of each list is complete: the alerts conclude
        // from an absence only behind it, as a stream processor waits for its
        // watermark.
        new Copy(
          catalog.get('program_pages_crawls'),
          destination.table('program_pages_crawls'),
          {
            id: 'lists:program_pages_crawls',
            syncMode: 'incremental',
            destinationSyncMode: 'append_dedup',
          },
        ),
        // The pages whose last visit failed, the crawl's dead letters: the
        // alerts wait for these pages, and take any other linked page that
        // the crawl stored nothing of as one that gave no text.
        new Copy(
          catalog.get('program_pages_failures'),
          destination.table('program_pages_failures'),
          {
            id: 'lists:program_pages_failures',
            syncMode: 'incremental',
            destinationSyncMode: 'append_dedup',
          },
        ),
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
