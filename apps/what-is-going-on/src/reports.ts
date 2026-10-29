import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { Collection } from '@zukhruf/embeddings';
import { EventDetector, design3152b } from '@zukhruf/event-grouping';
import { Declaration } from '@zukhruf/sqlite-drift';
import { transaction } from '@zukhruf/sqlite-transaction';
import { z } from 'zod';

import { type Connection, DerivedDataset } from '@workspace/elt';
import { SQLiteDestination, type SQLiteTable } from '@workspace/elt-sqlite';

import type { Source } from './sources.ts';

// Rebuilt from the crawled articles on any run, so a changed declaration
// replaces the rows.
const declaration = new Declaration(
  [
    `CREATE TABLE report (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      lead TEXT NOT NULL,
      source TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('lab', 'outlet')),
      publisher TEXT NOT NULL,
      -- When the report was published, declared by its page or given by its
      -- feed; null when neither gives a date.
      published_at INTEGER,
      -- When the app first stored the report.
      stored_at INTEGER NOT NULL,
      event INTEGER
    ) STRICT`,
    `CREATE TABLE source (
      site TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('lab', 'outlet')),
      feed TEXT
    ) STRICT`,
  ],
  { rows: 'replace' },
);

const articleSchema = z.object({
  inputUrl: z.string(),
  articleUrl: z.string(),
  title: z.string(),
  publishedTime: z.string().nullable(),
  published: z.string().nullable(),
  inferredPublished: z.string().nullable(),
  textContent: z.string(),
});

const sentences = new Intl.Segmenter('en', { granularity: 'sentence' });

// The first sentences of a report, which an interest's keywords are matched
// against with its title.
function lead(text: string) {
  return [...sentences.segment(text.trim())]
    .slice(0, 3)
    .map(({ segment }) => segment.trim())
    .join(' ');
}

// The reports of the crawled articles, each in the event of
// @zukhruf/event-grouping that it reports. Clustering again moves older
// reports between events, so each refresh writes every report's event again.
export class Reports extends DerivedDataset<SQLiteTable> {
  readonly name = 'reports';
  readonly #path: string;
  readonly #sources: readonly Source[];
  readonly #embeddings: string;

  constructor(options: {
    // The app's own SQLite file, which also keeps the detector's tables.
    path: string;
    sources: readonly Source[];
    // The OpenAI-compatible URL of the EmbeddingGemma 2 server.
    embeddings: string;
  }) {
    super();
    this.#path = options.path;
    this.#sources = options.sources;
    this.#embeddings = options.embeddings;
  }

  async refresh({
    connections,
  }: {
    readonly connections: readonly Connection<SQLiteTable>[];
  }) {
    const sources = new Map(
      this.#sources.flatMap((source) =>
        [source.site, source.feed ?? source.site].map((input) => [
          input,
          source,
        ]),
      ),
    );
    using database = new DatabaseSync(this.#path, { timeout: 30_000 });
    database.exec('PRAGMA journal_mode = WAL');
    declaration.apply(database);
    const upsert = database.prepare(
      `INSERT INTO report (id, url, title, lead, source, kind, publisher, published_at, stored_at)
      VALUES (:id, :url, :title, :lead, :source, :kind, :publisher, :published, :now)
      ON CONFLICT (id) DO UPDATE SET
        url = excluded.url, title = excluded.title, lead = excluded.lead,
        source = excluded.source, kind = excluded.kind, publisher = excluded.publisher,
        published_at = excluded.published_at
      RETURNING coalesce(published_at, stored_at) AS at`,
    );
    const addSource = database.prepare(
      'INSERT OR IGNORE INTO source (site, name, kind, feed) VALUES (?, ?, ?, ?)',
    );
    const now = Date.now();
    const reports = transaction(
      database,
      () => {
        database.exec('DELETE FROM source');
        for (const source of this.#sources)
          addSource.run(source.site, source.name, source.kind, source.feed);
        const reports = new Map<
          string,
          { title: string; body: string; publisher: string; publishedAt: Date }
        >();
        const rows = articles(connections)
          .flatMap((row) => {
            const source = sources.get(row.inputUrl);
            return source === undefined ? [] : [{ row, source }];
          })
          // One article reached from a lab's input and an outlet's is the lab's report.
          .toSorted(
            (a, b) =>
              Number(a.source.kind === 'outlet') -
              Number(b.source.kind === 'outlet'),
          );
        for (const { row, source } of rows) {
          if (reports.has(row.articleUrl)) continue;
          // The page's declared date first, then the date its feed gave,
          // then the date the page shows as text near its title.
          const published = [
            row.publishedTime,
            row.published,
            row.inferredPublished,
          ]
            .map((value) => Date.parse(value ?? ''))
            // A date in the future is wrong, as htmldate's max_date rule holds.
            .find((time) => !Number.isNaN(time) && time <= now);
          const publisher = new URL(row.articleUrl).host;
          const stored = upsert.get({
            id: row.articleUrl,
            url: row.articleUrl,
            title: row.title,
            lead: lead(row.textContent),
            source: source.name,
            kind: source.kind,
            publisher,
            published: published ?? null,
            now,
          });
          reports.set(row.articleUrl, {
            title: row.title,
            body: row.textContent,
            publisher,
            // The grouping needs a day; an undated report takes the day the app
            // first stored it.
            publishedAt: new Date(z.number().parse(stored?.at)),
          });
        }
        return reports;
      },
      { mode: 'immediate' },
    );

    const detector = new EventDetector({
      database,
      vectors: new Collection({
        database,
        model: createOpenAICompatible({
          name: 'llama.cpp',
          baseURL: this.#embeddings,
        }).embeddingModel(design3152b.embeddingModel),
      }),
      design: design3152b,
    });
    // The detector skips the reports it has already.
    await detector.add([...reports].map(([id, report]) => ({ id, ...report })));
    const setEvent = database.prepare(
      'UPDATE report SET event = ? WHERE id = ?',
    );
    transaction(
      database,
      () => {
        for (const event of detector.events({ since: new Date(0) }))
          for (const member of event.members) setEvent.run(event.id, member);
      },
      { mode: 'immediate' },
    );
  }
}

// The article pages that the copies loaded; list pages and pages without a
// title are not reports.
function articles(connections: readonly Connection<SQLiteTable>[]) {
  return connections.flatMap(({ destination, steps }) => {
    // A destination's file appears with its first pass's first record.
    if (
      !(destination instanceof SQLiteDestination) ||
      !existsSync(destination.path)
    )
      return [];
    using database = new DatabaseSync(destination.path, {
      readOnly: true,
      timeout: 30_000,
    });
    return steps.flatMap(({ to }) => {
      const relation = to.readerView ?? to.name;
      if (
        database
          .prepare('SELECT 1 FROM sqlite_schema WHERE name = ?')
          .get(relation) === undefined
      )
        return [];
      return database
        .prepare(
          `SELECT inputUrl, articleUrl, title, publishedTime, published, inferredPublished, textContent FROM "${relation}"
          WHERE NOT list AND title IS NOT NULL`,
        )
        .all()
        .map((row) => articleSchema.parse(row));
    });
  });
}
