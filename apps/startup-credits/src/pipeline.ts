import { join } from 'node:path';

import { Connection, Copy, Pipeline } from '@eltjs/elt';
import {
  ComputedDataset,
  SQLiteCheckpointStore,
  SQLiteDestination,
  SQLiteSyncHistory,
  View,
} from '@eltjs/elt-sqlite';
import {
  AdaptiveRevisit,
  CompositeRevisit,
  FixedRevisit,
  LinkReader,
  ListingReader,
  PaginationReader,
  hour,
} from '@eltjs/sdk-web-crawler';
import { ArticleExtractor } from '@eltjs/source-web-pages/article-extractor';
import { WebSource } from '@eltjs/source-web-pages/web-source';
import { WebStream } from '@eltjs/source-web-pages/web-stream';

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
        // A page whose last path segment names startups, such as /startups,
        // /startup-program/ or /arize-for-startups, and no page under a
        // startup section, such as its blog or events, which the sitemaps
        // of large websites list by the thousand (#3558). The URL filter of
        // a focused crawler (Introduction to Information Retrieval, 20.2).
        expand: [
          new URLPattern({
            pathname: String.raw`*/:page([^\/]*start-?up[^\/]*){/}?`,
          }),
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
// The language copies of each stored page, grouped as Google groups them:
// two pages are copies when each declares the other, in its head, its Link
// header or a sitemap (ADR 0016 of source-web-pages), and a group holds the
// copies that such pairs join. The page that stands for a group is its
// x-default copy, else an English one, else the smallest URL, so every page
// of a group names the same one. A declared copy that the crawl did not store
// is in no group.
const languageGroups = new View({
  into: destination,
  name: 'language_groups',
  description:
    'The page that stands for the language copies of each stored page; a page with no copy stands for itself.',
  columns: {
    articleUrl: 'The article URL of the stored page.',
    representative:
      'The article URL of the page that stands for its copies: the x-default copy, else an English one, else the smallest URL.',
  },
  sql: `WITH RECURSIVE
  declared(page, language, url) AS (
    SELECT p.articleUrl, copy.value ->> 'language', copy.value ->> 'url'
    FROM program_pages p, json_each(p.localizedVersions) copy
    UNION
    SELECT p.articleUrl, copy.value ->> 'language', copy.value ->> 'url'
    FROM program_pages p, json_each(p.listedVersions) copy
  ),
  -- A copy is a stored page, named by its article URL, the canonical URL
  -- that keys its row.
  copies(page, copy, language) AS (
    SELECT declared.page, program_pages.articleUrl, declared.language
    FROM declared JOIN program_pages ON program_pages.articleUrl = declared.url
  ),
  -- A one-way declaration, such as one that names a home page, joins nothing.
  pairs(page, copy) AS (
    SELECT a.page, a.copy FROM copies a
    JOIN copies b ON b.page = a.copy AND b.copy = a.page
    WHERE a.page <> a.copy
  ),
  members(page, member) AS (
    SELECT articleUrl, articleUrl FROM program_pages
    UNION
    SELECT members.page, pairs.copy
    FROM members JOIN pairs ON pairs.page = members.member
  ),
  -- How a group's own pages declare each member: x-default, English, other.
  ranks(page, member, rank) AS (
    SELECT members.page, members.member, MIN(CASE
      WHEN copies.language = 'x-default' THEN 0
      WHEN copies.language = 'en' OR copies.language LIKE 'en-%' THEN 1
      ELSE 2 END)
    FROM members
    LEFT JOIN members other ON other.page = members.page
    LEFT JOIN copies
      ON copies.page = other.member AND copies.copy = members.member
    GROUP BY members.page, members.member
  )
SELECT page AS articleUrl, member AS representative FROM ranks
WHERE NOT EXISTS (
  SELECT 1 FROM ranks better
  WHERE better.page = ranks.page
    AND (better.rank < ranks.rank
      OR (better.rank = ranks.rank AND better.member < ranks.member))
)`,
});
// Only the page that stands for its copies goes to Jev.
const representatives = new View({
  into: destination,
  name: 'representative_pages',
  description: 'The stored pages that stand for their language copies.',
  columns: {
    articleUrl: 'The article URL of the page.',
    title: 'The title of the page, or NULL.',
    textContent: 'The text of the page.',
  },
  sql: 'SELECT p.articleUrl, p.title, p.textContent FROM program_pages p JOIN language_groups g ON g.articleUrl = p.articleUrl AND g.representative = p.articleUrl',
});
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
  clock: globalThis,
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
    languageGroups,
    representatives,
    new ComputedDataset({
      into: destination,
      name: 'page_kinds',
      description:
        'The kind of each page that stands for its language copies, as Jev 1.14 labels it.',
      from: [representatives],
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
