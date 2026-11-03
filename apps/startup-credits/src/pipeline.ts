import { createHash } from 'node:crypto';
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
  StartReader,
  hour,
} from '@workspace/sdk-web-crawler';
import { ArticleExtractor } from '@workspace/source-web-pages/article-extractor';
import { WebSource } from '@workspace/source-web-pages/web-source';
import { WebStream } from '@workspace/source-web-pages/web-stream';

import directory from './directory.ts';
import { CriterionVerdicts } from './rules/criterion-verdicts.ts';
import { PageKinds } from './rules/page-kinds.ts';
import { ProgramOffers } from './rules/program-offers.ts';
import { creditsPath } from './warehouse.ts';

// GitHub lists of startup credit programs; the second links most programs'
// own pages, the first links more companies (#3352).
export const lists = [
  'https://github.com/avinash201199/awesome-startup-credits',
  'https://github.com/doanbactam/awesome-builder-programs',
];

const destination = new SQLiteDestination({ path: creditsPath });
// One process runs the passes, so a pass left running belongs to one that
// stopped.
const history = new SQLiteSyncHistory({ soleWriter: true });
const checkpoints = new SQLiteCheckpointStore({
  path: join(directory, 'checkpoints.sqlite'),
});

// The dataset of the verdicts on one criterion, named by its wording, so two
// queries that ask the same thing share the verdicts.
const verdictsDataset = (criterion: string) =>
  `criterion_${createHash('sha256').update(criterion).digest('hex').slice(0, 16)}`;

// The verdicts on every criterion, one row for each criterion and program
// page, so a reader asks for a criterion by its wording.
const verdictsSql = (criteria: readonly string[]) =>
  criteria
    .map(
      (criterion) =>
        `SELECT '${criterion.replaceAll("'", "''")}' AS criterion, articleUrl, status, error, meets, reason, quote FROM ${verdictsDataset(criterion)}`,
    )
    .join(' UNION ALL ');

// Each stored page with the columns that the views below read, from the
// lists' pages and, once a query found pages, the pages it found.
const storedPagesSql = (searched: boolean) =>
  ['program_pages', ...(searched ? ['search_pages'] : [])]
    .map(
      (table) =>
        `SELECT articleUrl, title, textContent, siteName, localizedVersions, listedVersions, loaded_at FROM ${table}`,
    )
    .join(' UNION ALL ');

// The pipeline that the queries shape: the program pages that their searches
// found are starting URLs, and each of their criteria is a dataset of
// verdicts. A WebSource takes its inputs when it is made, so the app builds
// the pipeline again when a query changes them (elt #3679).
export default async function pipeline({
  seeds,
  criteria,
}: {
  readonly seeds: readonly string[];
  readonly criteria: readonly string[];
}) {
  const source = new WebSource({
    streams: [
      {
        stream: new WebStream({
          name: 'program_pages',
          primaryKey: ['articleUrl'],
          // Each list hands back the pages it links on every website. A
          // linked page on another website is searched one step, its links
          // and its robots.txt sitemaps, for the pages that expand matches
          // (the crawler recipe "Search inside the sites a list links").
          readers: [
            new PaginationReader({ strategy: 'all' }),
            new ListingReader(),
            new LinkReader({ maxDepth: 0, maxPages: 0 }),
          ],
          // A page whose last path segment names startups, such as
          // /startups, /startup-program/ or /arize-for-startups, and no page
          // under a startup section, such as its blog or events, which the
          // sitemaps of large websites list by the thousand (#3558). The URL
          // filter of a focused crawler (Introduction to Information
          // Retrieval, 20.2).
          expand: [
            new URLPattern({
              pathname: String.raw`*/:page([^\/]*start-?up[^\/]*){/}?`,
            }),
          ],
          // Lists every hour; pages when they change, as AdaptiveRevisit
          // learns.
          revisit: new CompositeRevisit(
            lists.map((list) => [
              new URLPattern(list),
              new FixedRevisit({ every: hour }),
            ]),
            new AdaptiveRevisit(),
          ),
          // Every host but GitHub's, so a list's license and commits are not
          // pages (the crawler recipe "Follow a list to other websites").
          include: [new URLPattern({ hostname: '((?!github\\.com$).*)' })],
          extractor: new ArticleExtractor(),
        }),
        inputs: lists,
      },
      // A search result is a program page itself, not a list: the crawl
      // reads it and follows none of its links.
      ...(seeds.length === 0
        ? []
        : [
            {
              stream: new WebStream({
                name: 'search_pages',
                primaryKey: ['articleUrl'],
                readers: [new StartReader()],
                extractor: new ArticleExtractor(),
              }),
              inputs: seeds,
            },
          ]),
    ],
    // The crawler's name, which robots.txt groups match (RFC 9309).
    userAgent:
      'StartupCredits/0.1 (+https://github.com/ezzabuzaid/context-compiler)',
    cachePath: join(directory, 'web-http.sqlite'),
  });
  const catalog = await source.discover();
  const copy = (stream: string) =>
    new Copy(catalog.get(stream), destination.table(stream), {
      id: `web:${stream}`,
      syncMode: 'incremental',
      destinationSyncMode: 'append_dedup',
    });
  const storedPages = new View({
    into: destination,
    name: 'stored_pages',
    description:
      'Every stored page: the pages that the lists link and the pages that the queries found.',
    columns: {
      articleUrl: 'The article URL of the page.',
      title: 'The title of the page, or NULL.',
      textContent: 'The text of the page.',
      siteName: 'The name of the website, as the page states it, or NULL.',
      localizedVersions: 'The language copies that the page declares.',
      listedVersions: 'The language copies that a sitemap declares.',
      loaded_at: 'When the crawl last stored the page.',
    },
    sql: storedPagesSql(seeds.length > 0),
  });
  // The language copies of each stored page, grouped as Google groups them:
  // two pages are copies when each declares the other, in its head, its Link
  // header or a sitemap (ADR 0016 of source-web-pages), and a group holds
  // the copies that such pairs join. The page that stands for a group is its
  // x-default copy, else an English one, else the smallest URL, so every page
  // of a group names the same one. A declared copy that the crawl did not
  // store is in no group.
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
    FROM stored_pages p, json_each(p.localizedVersions) copy
    UNION
    SELECT p.articleUrl, copy.value ->> 'language', copy.value ->> 'url'
    FROM stored_pages p, json_each(p.listedVersions) copy
  ),
  -- A copy is a stored page, named by its article URL, the canonical URL
  -- that keys its row.
  copies(page, copy, language) AS (
    SELECT declared.page, stored_pages.articleUrl, declared.language
    FROM declared JOIN stored_pages ON stored_pages.articleUrl = declared.url
  ),
  -- A one-way declaration, such as one that names a home page, joins nothing.
  pairs(page, copy) AS (
    SELECT a.page, a.copy FROM copies a
    JOIN copies b ON b.page = a.copy AND b.copy = a.page
    WHERE a.page <> a.copy
  ),
  members(page, member) AS (
    SELECT articleUrl, articleUrl FROM stored_pages
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
    sql: 'SELECT p.articleUrl, p.title, p.textContent FROM stored_pages p JOIN language_groups g ON g.articleUrl = p.articleUrl AND g.representative = p.articleUrl',
  });
  // Only the pages labelled program go to the offer model and the criteria.
  const programs = new View({
    into: destination,
    name: 'programs',
    description: 'The stored pages that Jev labels program.',
    columns: {
      articleUrl: 'The article URL of the program page.',
      title: 'The title of the page, or NULL.',
      textContent: 'The text of the page.',
    },
    sql: "SELECT p.articleUrl, p.title, p.textContent FROM stored_pages p JOIN page_kinds k USING (articleUrl) WHERE k.status = 'computed' AND k.kind = 'program'",
  });
  return new Pipeline({
    clock: globalThis,
    history,
    connections: [
      new Connection({
        name: 'web',
        source,
        destination,
        checkpoints,
        steps: [
          copy('program_pages'),
          // Every route by which the crawl found a page: the alerts follow
          // them from each link of a list to the pages that it led to.
          copy('program_pages_routes'),
          // Whether the crawl of each list is complete: the alerts conclude
          // from an absence only behind it, as a stream processor waits for
          // its watermark.
          copy('program_pages_crawls'),
          // The pages whose last visit failed, the crawl's dead letters: the
          // alerts wait for these pages, and take any other linked page that
          // the crawl stored nothing of as one that gave no text.
          copy('program_pages_failures'),
          // The pages that the queries' searches found.
          ...(seeds.length === 0 ? [] : [copy('search_pages')]),
        ],
      }),
    ],
    derived: [
      storedPages,
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
      ...criteria.map(
        (criterion) =>
          new ComputedDataset({
            into: destination,
            name: verdictsDataset(criterion),
            description: `Whether each program page meets the criterion: ${criterion}`,
            from: [programs],
            compute: new CriterionVerdicts(criterion),
          }),
      ),
      ...(criteria.length === 0
        ? []
        : [
            new View({
              into: destination,
              name: 'verdicts',
              description:
                'Whether each program page meets each criterion of the queries, as GPT-6-Luna reads the page.',
              columns: {
                criterion: 'The wording of the criterion.',
                articleUrl: 'The article URL of the program page.',
                status:
                  'computed: the model judged the page. failed: the call failed, error says why.',
                error: 'Why the call failed. NULL unless status is failed.',
                meets: 'yes or no. NULL unless status is computed.',
                reason: "The model's reason. NULL unless status is computed.",
                quote:
                  'The sentence of the page that decides, or NULL when the page has none.',
              },
              sql: verdictsSql(criteria),
            }),
          ]),
    ],
  });
}
