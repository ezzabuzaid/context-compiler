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
  LinkReader,
  ListingReader,
  PaginationReader,
  StartReader,
} from '@eltjs/sdk-web-crawler';
import { ArticleExtractor } from '@eltjs/source-web-pages/article-extractor';
import { WebSource, webInput } from '@eltjs/source-web-pages/web-source';
import { WebStream } from '@eltjs/source-web-pages/web-stream';

import { DefinitionsSource } from './definitions/definitions-source.ts';
import directory from './directory.ts';
import { Evaluation } from './rules/evaluation.ts';
import { FieldValue } from './rules/field.ts';
import store, { type Crawled, storePath } from './store.ts';
import { warehousePath } from './warehouse.ts';
import client from './web-client.ts';

const destination = new SQLiteDestination({ path: warehousePath });
// One process runs the passes, so a pass left running belongs to one that
// stopped.
const history = new SQLiteSyncHistory({ soleWriter: true });
const checkpoints = new SQLiteCheckpointStore({
  path: join(directory, 'checkpoints.sqlite'),
});

// The starting URLs of a dataset that are pages: those that it gives and
// those that its search found.
const pagesOf = ({ pages, seeds }: Pick<Crawled, 'pages' | 'seeds'>) => [
  ...pages,
  ...seeds,
];

// The pipeline of the datasets, made once: the pages of each dataset and the
// pages that its search found are read as pages, its lists as lists, and
// what each dataset asks comes from api.sqlite through the definitions, so
// each criterion of each page and each field of each item is judged or read
// by one computed dataset, and a page and a criterion that two datasets share
// are judged once. The web source reads the starting URLs from api.sqlite as
// each read opens and at each check of its watch, so a new dataset, or a
// page that a search found, is crawled in the pass that the next check asks
// for, after a pass that runs then (elt ADR 0018 of source-web-pages).
export default async function pipeline() {
  const streams = [
    // A page is read itself; the crawl follows none of its links.
    {
      stream: new WebStream({
        name: 'pages',
        primaryKey: ['articleUrl'],
        readers: [new StartReader()],
        extractor: new ArticleExtractor(),
      }),
      inputs: () => new Set(store.crawled().flatMap(pagesOf).map(webInput)),
    },
    // A list hands back the pages it links on every website, as the crawler
    // recipe "Follow a list to other websites" reads a list of links.
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
      inputs: () =>
        new Set(
          store
            .crawled()
            .flatMap(({ lists }) => lists)
            .map(webInput),
        ),
    },
  ];
  const source = new WebSource({ streams, client });
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
  // A page that two starting URLs of a dataset led to is one candidate, as
  // last stored.
  const candidates = new View({
    into: destination,
    name: 'candidates',
    description: 'The pages of each dataset.',
    columns: {
      dataset: 'The id of the dataset.',
      inputUrl: 'The starting URL that led to the page.',
      articleUrl: 'The article URL of the page.',
      title: 'The title of the page, or NULL.',
      textContent: 'The text of the page.',
      loaded_at: 'When the crawl last stored the page.',
    },
    sql: `SELECT i.dataset, s.inputUrl, s.articleUrl, s.title, s.textContent, MAX(s.loaded_at) AS loaded_at
      FROM stored_pages s JOIN dataset_inputs i ON i.inputUrl = s.inputUrl
      GROUP BY i.dataset, s.articleUrl`,
  });
  const judgmentInputs = new View({
    into: destination,
    name: 'judgment_inputs',
    description:
      'Each page with each criterion that a dataset of the page asks, once.',
    columns: {
      pair: 'The article URL and the criterion, as a JSON array.',
      articleUrl: 'The article URL of the page.',
      title: 'The title of the page, or NULL.',
      textContent: 'The text of the page.',
      criterion: 'What the criterion asks of the page.',
    },
    sql: `SELECT DISTINCT json_array(c.articleUrl, k.criterion) AS pair, c.articleUrl, c.title, c.textContent, k.criterion
      FROM candidates c JOIN dataset_criteria k ON k.dataset = c.dataset`,
  });
  const judgments = new ComputedDataset({
    into: destination,
    name: 'judgments',
    description: 'Whether each page meets each criterion asked of it.',
    from: [judgmentInputs],
    compute: new Evaluation(),
  });
  // Fields are read only from the pages that meet every criterion of their
  // dataset; a dataset whose criteria have not reached the warehouse yet has
  // none.
  const matches = new View({
    into: destination,
    name: 'matches',
    description: 'The pages of each dataset that meet every criterion.',
    columns: {
      dataset: 'The id of the dataset.',
      articleUrl: 'The article URL of the page.',
      title: 'The title of the page, or NULL.',
      textContent: 'The text of the page.',
    },
    sql: `SELECT c.dataset, c.articleUrl, c.title, c.textContent FROM candidates c
      WHERE EXISTS (SELECT 1 FROM dataset_criteria k WHERE k.dataset = c.dataset)
      AND NOT EXISTS (
        SELECT 1 FROM dataset_criteria k WHERE k.dataset = c.dataset AND NOT EXISTS (
          SELECT 1 FROM judgments j WHERE j.pair = json_array(c.articleUrl, k.criterion)
          AND j.status = 'computed' AND j.satisfied = 'yes'))`,
  });
  const fieldInputs = new View({
    into: destination,
    name: 'field_inputs',
    description:
      'Each page that meets every criterion of a dataset, with each field that the dataset reads, once.',
    columns: {
      pair: 'The article URL and the field, as a JSON array of the URL, the description, the format and the options.',
      articleUrl: 'The article URL of the page.',
      title: 'The title of the page, or NULL.',
      textContent: 'The text of the page.',
      description: 'What the field is.',
      format: 'The format of the value.',
      options: 'The options of an options field as a JSON array, or NULL.',
    },
    sql: `SELECT DISTINCT json_array(m.articleUrl, f.description, f.format, f.options) AS pair,
      m.articleUrl, m.title, m.textContent, f.description, f.format, f.options
      FROM matches m JOIN dataset_fields f ON f.dataset = m.dataset`,
  });
  const fieldResults = new ComputedDataset({
    into: destination,
    name: 'field_results',
    description: 'Each field of each page that meets every criterion.',
    from: [fieldInputs],
    compute: new FieldValue(),
  });
  // The API reads every dataset through these views, so it binds a dataset
  // id instead of naming its tables.
  const evaluations = new View({
    into: destination,
    name: 'evaluations',
    description: 'Whether each page of each dataset meets each criterion.',
    columns: {
      dataset: 'The id of the dataset.',
      criterion: 'The position of the criterion in the dataset, from 0.',
      articleUrl: 'The article URL of the page.',
      status: 'computed: the model judged the page. failed: error says why.',
      error: 'Why the call failed. NULL unless status is failed.',
      satisfied: 'yes, no or unclear. NULL unless status is computed.',
      reasoning: "The model's reasoning. NULL unless status is computed.",
      quote: 'The sentence of the page that decides, or NULL.',
    },
    sql: `SELECT c.dataset, k.position AS criterion, c.articleUrl, j.status, j.error, j.satisfied, j.reasoning, j.quote
      FROM candidates c JOIN dataset_criteria k ON k.dataset = c.dataset
      JOIN judgments j ON j.pair = json_array(c.articleUrl, k.criterion)`,
  });
  const fieldValues = new View({
    into: destination,
    name: 'field_values',
    description: 'Each field of each page that meets every criterion.',
    columns: {
      dataset: 'The id of the dataset.',
      field: 'The name of the field.',
      articleUrl: 'The article URL of the page.',
      status: 'computed: the model read the field. failed: error says why.',
      error: 'Why the call failed. NULL unless status is failed.',
      value: 'The value as JSON. NULL unless status is computed.',
      quote: 'The sentence of the page that states the value, or NULL.',
    },
    sql: `SELECT m.dataset, f.name AS field, m.articleUrl, r.status, r.error, r.value, r.quote
      FROM matches m JOIN dataset_fields f ON f.dataset = m.dataset
      JOIN field_results r ON r.pair = json_array(m.articleUrl, f.description, f.format, f.options)`,
  });
  const definitions = new DefinitionsSource(storePath);
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
      // Each pass replaces the definitions; the inputs come last, so a
      // dataset's pages join its criteria and fields only once they are there.
      new Connection({
        name: 'definitions',
        source: definitions,
        destination,
        checkpoints,
        steps: [
          definitions.criteria,
          definitions.fields,
          definitions.inputs,
        ].map(
          (stream) =>
            new Copy(stream, destination.table(stream.name), {
              id: `definitions:${stream.name}`,
              syncMode: 'full_refresh',
              destinationSyncMode: 'overwrite',
            }),
        ),
      }),
    ],
    derived: [
      storedPages,
      candidates,
      judgmentInputs,
      judgments,
      matches,
      fieldInputs,
      fieldResults,
      evaluations,
      fieldValues,
    ],
  });
}
