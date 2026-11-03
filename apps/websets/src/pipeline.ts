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
  LinkReader,
  ListingReader,
  PaginationReader,
  StartReader,
} from '@workspace/sdk-web-crawler';
import { ArticleExtractor } from '@workspace/source-web-pages/article-extractor';
import { WebSource } from '@workspace/source-web-pages/web-source';
import { WebStream } from '@workspace/source-web-pages/web-stream';

import directory from './directory.ts';
import { Evaluation } from './rules/evaluation.ts';
import { FieldValue } from './rules/field.ts';
import type { Crawled } from './store.ts';
import { warehousePath } from './warehouse.ts';

const destination = new SQLiteDestination({ path: warehousePath });
// One process runs the passes, so a pass left running belongs to one that
// stopped.
const history = new SQLiteSyncHistory({ soleWriter: true });
const checkpoints = new SQLiteCheckpointStore({
  path: join(directory, 'checkpoints.sqlite'),
});

const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;

// The starting URLs of a collection that are pages: those that it gives and
// those that its search found.
export const pagesOf = ({ pages, seeds }: Crawled) => [...pages, ...seeds];

// The pipeline that the collections shape: their pages and the pages of
// their searches are read as pages, their lists as lists, and each criterion
// and field of a collection is a dataset of its pages. A WebSource takes its
// inputs when it is made, so the app builds the pipeline again when a
// collection changes them (elt #3679). No input, no pipeline.
export default async function pipeline(collections: readonly Crawled[]) {
  const pages = [...new Set(collections.flatMap(pagesOf))].toSorted();
  const lists = [
    ...new Set(collections.flatMap(({ lists: of }) => of)),
  ].toSorted();
  if (pages.length === 0 && lists.length === 0) {
    return null;
  }
  const streams = [
    // A page is read itself; the crawl follows none of its links.
    ...(pages.length === 0
      ? []
      : [
          {
            stream: new WebStream({
              name: 'pages',
              primaryKey: ['articleUrl'],
              readers: [new StartReader()],
              extractor: new ArticleExtractor(),
            }),
            inputs: pages,
          },
        ]),
    // A list hands back the pages it links on every website, as the crawler
    // recipe "Follow a list to other websites" reads a list of links.
    ...(lists.length === 0
      ? []
      : [
          {
            stream: new WebStream({
              name: 'listed',
              primaryKey: ['articleUrl'],
              readers: [
                new PaginationReader({ strategy: 'all' }),
                new ListingReader(),
                new LinkReader({ maxDepth: 0, maxPages: 0 }),
              ],
              extractor: new ArticleExtractor(),
            }),
            inputs: lists,
          },
        ]),
  ];
  const source = new WebSource({
    streams,
    // The crawler's name, which robots.txt groups match (RFC 9309).
    userAgent: 'Websets/0.1 (+https://github.com/ezzabuzaid/context-compiler)',
    cachePath: join(directory, 'web-http.sqlite'),
  });
  const catalog = await source.discover();
  const tables = streams.map(({ stream }) => stream.name);
  const storedPages = new View({
    into: destination,
    name: 'stored_pages',
    description: 'Every stored page, under the starting URL that led to it.',
    columns: {
      inputUrl:
        'The starting URL: a page, a page that a search found, or a list.',
      articleUrl: 'The article URL of the page.',
      title: 'The title of the page, or NULL.',
      textContent: 'The text of the page.',
      loaded_at: 'When the crawl last stored the page.',
    },
    sql: tables
      .map(
        (table) =>
          `SELECT inputUrl, articleUrl, title, textContent, loaded_at FROM ${table}`,
      )
      .join(' UNION ALL '),
  });
  const derived: (View | ComputedDataset<unknown, string>)[] = [storedPages];
  const candidates: string[] = [];
  const evaluations: string[] = [];
  const values: string[] = [];
  for (const collection of collections) {
    const { id, criteria, fields } = collection;
    const inputs = [...pagesOf(collection), ...collection.lists];
    // A page that two starting URLs led to is one candidate, as last stored.
    const candidate = new View({
      into: destination,
      name: `${id}_candidates`,
      description: `The pages of collection ${id}.`,
      columns: {
        inputUrl: 'The starting URL that led to the page.',
        articleUrl: 'The article URL of the page.',
        title: 'The title of the page, or NULL.',
        textContent: 'The text of the page.',
        loaded_at: 'When the crawl last stored the page.',
      },
      sql: `SELECT inputUrl, articleUrl, title, textContent, MAX(loaded_at) AS loaded_at FROM stored_pages
        WHERE inputUrl IN (${inputs.map(literal).join(', ')}) GROUP BY articleUrl`,
    });
    derived.push(candidate);
    candidates.push(
      `SELECT ${literal(id)} AS collection, inputUrl, articleUrl, title, loaded_at FROM ${id}_candidates`,
    );
    for (const [index, { description }] of criteria.entries()) {
      derived.push(
        new ComputedDataset({
          into: destination,
          name: `${id}_criterion_${index}`,
          description: `Whether each page of collection ${id} meets: ${description}`,
          from: [candidate],
          compute: new Evaluation(description),
        }),
      );
      evaluations.push(
        `SELECT ${literal(id)} AS collection, ${index} AS criterion, articleUrl, status, error, satisfied, reasoning, quote FROM ${id}_criterion_${index}`,
      );
    }
    // Fields are read only from the pages that meet every criterion.
    const matches = new View({
      into: destination,
      name: `${id}_matches`,
      description: `The pages of collection ${id} that meet every criterion.`,
      columns: {
        articleUrl: 'The article URL of the page.',
        title: 'The title of the page, or NULL.',
        textContent: 'The text of the page.',
      },
      sql: `SELECT c.articleUrl, c.title, c.textContent FROM ${id}_candidates c ${criteria
        .map(
          (_, index) =>
            `JOIN ${id}_criterion_${index} e${index} ON e${index}.articleUrl = c.articleUrl AND e${index}.status = 'computed' AND e${index}.satisfied = 'yes'`,
        )
        .join(' ')}`,
    });
    derived.push(matches);
    for (const field of fields) {
      derived.push(
        new ComputedDataset({
          into: destination,
          name: `${id}_field_${field.name}`,
          description: `The ${field.name} of each page of collection ${id} that meets every criterion.`,
          from: [matches],
          compute: new FieldValue(field),
        }),
      );
      values.push(
        `SELECT ${literal(id)} AS collection, ${literal(field.name)} AS field, articleUrl, status, error, value, quote FROM ${id}_field_${field.name}`,
      );
    }
  }
  // The API reads every collection through these views, so it binds a
  // collection id instead of naming its tables.
  derived.push(
    new View({
      into: destination,
      name: 'candidates',
      description: 'The pages of each collection.',
      columns: {
        collection: 'The id of the collection.',
        inputUrl: 'The starting URL that led to the page.',
        articleUrl: 'The article URL of the page.',
        title: 'The title of the page, or NULL.',
        loaded_at: 'When the crawl last stored the page.',
      },
      sql: candidates.join(' UNION ALL '),
    }),
    new View({
      into: destination,
      name: 'evaluations',
      description: 'Whether each page of each collection meets each criterion.',
      columns: {
        collection: 'The id of the collection.',
        criterion: 'The position of the criterion in the collection, from 0.',
        articleUrl: 'The article URL of the page.',
        status: 'computed: the model judged the page. failed: error says why.',
        error: 'Why the call failed. NULL unless status is failed.',
        satisfied: 'yes, no or unclear. NULL unless status is computed.',
        reasoning: "The model's reasoning. NULL unless status is computed.",
        quote: 'The sentence of the page that decides, or NULL.',
      },
      sql: evaluations.join(' UNION ALL '),
    }),
  );
  if (values.length > 0) {
    derived.push(
      new View({
        into: destination,
        name: 'field_values',
        description: 'Each field of each page that meets every criterion.',
        columns: {
          collection: 'The id of the collection.',
          field: 'The name of the field.',
          articleUrl: 'The article URL of the page.',
          status: 'computed: the model read the field. failed: error says why.',
          error: 'Why the call failed. NULL unless status is failed.',
          value: 'The value as JSON. NULL unless status is computed.',
          quote: 'The sentence of the page that states the value, or NULL.',
        },
        sql: values.join(' UNION ALL '),
      }),
    );
  }
  return new Pipeline({
    clock: globalThis,
    history,
    connections: [
      new Connection({
        name: 'web',
        source,
        destination,
        checkpoints,
        steps: tables.map(
          (table) =>
            new Copy(catalog.get(table), destination.table(table), {
              id: `web:${table}`,
              syncMode: 'incremental',
              destinationSyncMode: 'append_dedup',
            }),
        ),
      }),
    ],
    derived,
  });
}
