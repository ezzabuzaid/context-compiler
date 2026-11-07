import { randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { Declaration } from '@zukhruf/sqlite-drift';
import { open } from '@zukhruf/sqlite-open';
import { transaction } from '@zukhruf/sqlite-transaction';
import { z } from 'zod';

import type { Definition } from './dataset.ts';
import directory from './directory.ts';
import type { Item } from './items.ts';
import type { MonitorDefinition } from './monitor.ts';
import type { Found } from './search.ts';

// What the consumers asked for: their datasets, the pages that the search of
// each found, and their monitors with how each last ran. No pipeline run can
// rebuild them, so a changed declaration keeps the rows.
const asked = new Declaration(
  [
    `CREATE TABLE dataset (
      id TEXT PRIMARY KEY,
      definition TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT`,
    `CREATE TABLE search (
      dataset TEXT PRIMARY KEY REFERENCES dataset (id) ON DELETE CASCADE,
      state TEXT NOT NULL CHECK (state IN ('pending', 'done', 'failed')),
      error TEXT,
      at TEXT,
      CHECK ((state = 'failed') = (error IS NOT NULL)),
      CHECK ((state = 'pending') = (at IS NULL))
    ) STRICT`,
    `CREATE TABLE seed (
      dataset TEXT NOT NULL REFERENCES dataset (id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      rank INTEGER NOT NULL,
      PRIMARY KEY (dataset, url)
    ) STRICT`,
    `CREATE TABLE monitor (
      id TEXT PRIMARY KEY,
      definition TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT`,
    `CREATE TABLE last_run (
      monitor TEXT PRIMARY KEY REFERENCES monitor (id) ON DELETE CASCADE,
      at TEXT NOT NULL,
      error TEXT
    ) STRICT`,
  ],
  { rows: 'keep' },
);

// What the API told: the id it gave each item and the fields that its last
// event reported; what each monitor's last run read, which its next run
// compares with: a page's text, and every page that a search found; the
// event log of the datasets and the monitors; and why a page did not load. A
// changed declaration starts a new log with a new epoch, so every cursor of
// the old log is gone, and each monitor takes its baseline again.
const told = new Declaration(
  [
    'CREATE TABLE log (epoch TEXT NOT NULL) STRICT',
    `CREATE TABLE item (
      dataset TEXT NOT NULL,
      article_url TEXT NOT NULL,
      id TEXT NOT NULL UNIQUE,
      matches INTEGER NOT NULL CHECK (matches IN (0, 1)),
      fields TEXT NOT NULL,
      PRIMARY KEY (dataset, article_url)
    ) STRICT`,
    `CREATE TABLE snapshot (
      monitor TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      read_at TEXT NOT NULL
    ) STRICT`,
    `CREATE TABLE sighted (
      monitor TEXT PRIMARY KEY,
      urls TEXT NOT NULL
    ) STRICT`,
    `CREATE TABLE event (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      resource TEXT NOT NULL,
      type TEXT NOT NULL,
      data TEXT NOT NULL,
      previous TEXT,
      created_at TEXT NOT NULL
    ) STRICT`,
    `CREATE TABLE failure (
      url TEXT PRIMARY KEY,
      reason TEXT NOT NULL,
      failed_at TEXT NOT NULL
    ) STRICT`,
  ],
  { rows: 'replace' },
);

const datasetRow = z.object({
  id: z.string(),
  definition: z.string(),
  created_at: z.string(),
  state: z.enum(['pending', 'done', 'failed']).nullable(),
  error: z.string().nullable(),
  at: z.string().nullable(),
});
const seedRow = z.object({
  dataset: z.string(),
  url: z.string(),
  rank: z.number(),
});
const itemRow = z.object({
  id: z.string(),
  matches: z.union([z.literal(0), z.literal(1)]),
  fields: z.string(),
});
const monitorRow = z.object({
  id: z.string(),
  definition: z.string(),
  created_at: z.string(),
  at: z.string().nullable(),
  error: z.string().nullable(),
});
const snapshotRow = z.object({ text: z.string(), read_at: z.string() });
const sightedRow = z.object({ urls: z.string() });
const eventRow = z.object({
  seq: z.number(),
  type: z.string(),
  data: z.string(),
  previous: z.string().nullable(),
  created_at: z.string(),
});
const logRow = z.object({ epoch: z.string() });
const itemIdRow = z.object({ article_url: z.string(), id: z.string() });
const failureRow = z.object({
  url: z.string(),
  reason: z.string(),
  failed_at: z.string(),
});
const cursorSchema = z.object({ epoch: z.string(), seq: z.number().int() });
const itemEventType = z.enum(['item.created', 'item.updated', 'item.removed']);
const monitorEventType = z.enum(['page.changed', 'search.found']);

// A dataset with how its search went: none when it has no search,
// pending until the search ends, and done or failed with the time.
export type Dataset = Definition & {
  readonly id: string;
  readonly createdAt: string;
  readonly searched:
    | { readonly state: 'none' }
    | { readonly state: 'pending' }
    | { readonly state: 'done'; readonly at: string }
    | { readonly state: 'failed'; readonly at: string; readonly error: string };
};

// A dataset with the pages that its search found, as the crawl reads it.
export type Crawled = Dataset & { readonly seeds: readonly string[] };

// The fields that the model has read from an item, by name.
type Fields = Readonly<Record<string, unknown>>;

// A monitor with how its last run went: none yet, done, or failed with its
// reason, as Exa's monitors give their last run.
type Monitor = MonitorDefinition & {
  readonly id: string;
  readonly createdAt: string;
  readonly lastRun:
    | null
    | { readonly state: 'done'; readonly at: string }
    | { readonly state: 'failed'; readonly at: string; readonly error: string };
};

// A change to an item, as the event log reports it: the item after it, and
// for item.updated the fields before it.
type ItemChange =
  | {
      readonly type: 'item.created' | 'item.removed';
      readonly data: Item;
      readonly previous: null;
    }
  | {
      readonly type: 'item.updated';
      readonly data: Item;
      readonly previous: { readonly fields: Fields };
    };

// What a monitor's run found changed: a page's text, as a unified diff, or
// the pages that its search had never found.
export type MonitorChange =
  | {
      readonly type: 'page.changed';
      readonly data: { readonly url: string; readonly diff: string };
    }
  | {
      readonly type: 'search.found';
      readonly data: { readonly urls: readonly string[] };
    };

type Logged = { readonly cursor: string; readonly createdAt: string };

// One page of a resource's events, oldest first, and whether more follow.
type Events<T> =
  | {
      readonly data: readonly (T & Logged)[];
      readonly hasMore: boolean;
      readonly nextCursor: string;
    }
  | 'gone'
  | 'invalid';

const now = () => new Date().toISOString();

function dataset(row: unknown): Dataset {
  const parsed = datasetRow.parse(row);
  let searched: Dataset['searched'];
  if (parsed.state === null) {
    searched = { state: 'none' };
  } else if (parsed.at === null) {
    searched = { state: 'pending' };
  } else if (parsed.error === null) {
    searched = { state: 'done', at: parsed.at };
  } else {
    searched = { state: 'failed', at: parsed.at, error: parsed.error };
  }
  // As addDataset stored it, after the route validated it.
  const definition: Definition = JSON.parse(parsed.definition);
  return {
    ...definition,
    id: parsed.id,
    createdAt: parsed.created_at,
    searched,
  };
}

const selectDatasets = `SELECT d.id, d.definition, d.created_at, s.state, s.error, s.at
  FROM dataset d LEFT JOIN search s ON s.dataset = d.id`;

function monitor(row: unknown): Monitor {
  const parsed = monitorRow.parse(row);
  let lastRun: Monitor['lastRun'];
  if (parsed.at === null) {
    lastRun = null;
  } else if (parsed.error === null) {
    lastRun = { state: 'done', at: parsed.at };
  } else {
    lastRun = { state: 'failed', at: parsed.at, error: parsed.error };
  }
  // As addMonitor stored it, after the route validated it.
  const definition: MonitorDefinition = JSON.parse(parsed.definition);
  return {
    ...definition,
    id: parsed.id,
    createdAt: parsed.created_at,
    lastRun,
  };
}

const selectMonitors = `SELECT m.id, m.definition, m.created_at, r.at, r.error
  FROM monitor m LEFT JOIN last_run r ON r.monitor = m.id`;

// The API's own file, api.sqlite, beside the warehouse that elt fills.
class Store {
  readonly #db: DatabaseSync;
  readonly #epoch: string;

  constructor(path: string) {
    this.#db = open(path);
    asked.apply(this.#db);
    told.apply(this.#db);
    const epoch = logRow
      .optional()
      .parse(this.#db.prepare('SELECT epoch FROM log').get());
    this.#epoch = epoch?.epoch ?? randomUUID();
    if (epoch === undefined) {
      this.#db.prepare('INSERT INTO log (epoch) VALUES (?)').run(this.#epoch);
    }
  }

  // Runs the writes of one change together, so a reader never sees an event
  // without the state that it reports.
  transaction<T>(write: () => T extends PromiseLike<unknown> ? never : T): T {
    return transaction(this.#db, write, { mode: 'immediate' });
  }

  // A dataset id is a SQL identifier too: the pipeline names the views
  // and computed datasets of each dataset after it.
  addDataset(definition: Definition): Dataset {
    const id = `ds_${randomBytes(8).toString('hex')}`;
    this.transaction(() => {
      this.#db
        .prepare(
          'INSERT INTO dataset (id, definition, created_at) VALUES (?, ?, ?)',
        )
        .run(id, JSON.stringify(definition), now());
      if (definition.search !== undefined) {
        this.#db
          .prepare("INSERT INTO search (dataset, state) VALUES (?, 'pending')")
          .run(id);
      }
    });
    return this.dataset(id)!;
  }

  datasets(): readonly Dataset[] {
    return this.#db
      .prepare(`${selectDatasets} ORDER BY d.created_at, d.id`)
      .all()
      .map(dataset);
  }

  dataset(id: string): Dataset | undefined {
    const row = this.#db.prepare(`${selectDatasets} WHERE d.id = ?`).get(id);
    return row === undefined ? undefined : dataset(row);
  }

  crawled(): readonly Crawled[] {
    return this.datasets().map((given) => ({
      ...given,
      seeds: this.seeds(given.id).map(({ url }) => url),
    }));
  }

  // The dataset, its seeds and its monitors go; its events and items stay in
  // the log.
  deleteDataset(id: string): void {
    this.transaction(() => {
      for (const { id: watching } of this.monitorsOf(id)) {
        this.deleteMonitor(watching);
      }
      this.#db.prepare('DELETE FROM dataset WHERE id = ?').run(id);
    });
  }

  addMonitor(definition: MonitorDefinition): Monitor {
    const id = `mon_${randomBytes(8).toString('hex')}`;
    this.#db
      .prepare(
        'INSERT INTO monitor (id, definition, created_at) VALUES (?, ?, ?)',
      )
      .run(id, JSON.stringify(definition), now());
    return this.monitor(id)!;
  }

  monitors(): readonly Monitor[] {
    return this.#db
      .prepare(`${selectMonitors} ORDER BY m.created_at, m.id`)
      .all()
      .map(monitor);
  }

  monitor(id: string): Monitor | undefined {
    const row = this.#db.prepare(`${selectMonitors} WHERE m.id = ?`).get(id);
    return row === undefined ? undefined : monitor(row);
  }

  // The monitors that run a dataset's search again.
  monitorsOf(datasetId: string): readonly Monitor[] {
    return this.#db
      .prepare(
        `${selectMonitors} WHERE m.definition ->> '$.target.dataset' = ? ORDER BY m.created_at, m.id`,
      )
      .all(datasetId)
      .map(monitor);
  }

  // The monitor and what its runs read go; its events stay in the log.
  deleteMonitor(id: string): void {
    this.transaction(() => {
      for (const table of ['snapshot', 'sighted']) {
        this.#db.prepare(`DELETE FROM ${table} WHERE monitor = ?`).run(id);
      }
      this.#db.prepare('DELETE FROM monitor WHERE id = ?').run(id);
    });
  }

  checked(id: string): void {
    this.#db
      .prepare(
        'INSERT INTO last_run (monitor, at, error) VALUES (?, ?, NULL) ON CONFLICT (monitor) DO UPDATE SET at = excluded.at, error = NULL',
      )
      .run(id, now());
  }

  checkFailed(id: string, error: string): void {
    this.#db
      .prepare(
        'INSERT INTO last_run (monitor, at, error) VALUES (?, ?, ?) ON CONFLICT (monitor) DO UPDATE SET at = excluded.at, error = excluded.error',
      )
      .run(id, now(), error);
  }

  // The text of a page monitor's page at its last run that read it.
  snapshot(
    id: string,
  ): { readonly text: string; readonly readAt: string } | undefined {
    const row = this.#db
      .prepare('SELECT text, read_at FROM snapshot WHERE monitor = ?')
      .get(id);
    if (row === undefined) {
      return undefined;
    }
    const parsed = snapshotRow.parse(row);
    return { text: parsed.text, readAt: parsed.read_at };
  }

  saveSnapshot(
    id: string,
    { text, readAt }: { readonly text: string; readonly readAt: string },
  ): void {
    this.#db
      .prepare(
        'INSERT INTO snapshot (monitor, text, read_at) VALUES (?, ?, ?) ON CONFLICT (monitor) DO UPDATE SET text = excluded.text, read_at = excluded.read_at',
      )
      .run(id, text, readAt);
  }

  // Every page that a search monitor's runs found, or none before its first.
  sighted(id: string): readonly string[] | undefined {
    const row = this.#db
      .prepare('SELECT urls FROM sighted WHERE monitor = ?')
      .get(id);
    // As saveSighted stored it.
    return row === undefined
      ? undefined
      : JSON.parse(sightedRow.parse(row).urls);
  }

  saveSighted(id: string, urls: readonly string[]): void {
    this.#db
      .prepare(
        'INSERT INTO sighted (monitor, urls) VALUES (?, ?) ON CONFLICT (monitor) DO UPDATE SET urls = excluded.urls',
      )
      .run(id, JSON.stringify(urls));
  }

  searching(id: string): void {
    this.#db
      .prepare(
        "UPDATE search SET state = 'pending', error = NULL, at = NULL WHERE dataset = ?",
      )
      .run(id);
  }

  searched(id: string, found: readonly Found[]): void {
    this.transaction(() => {
      const insert = this.#db.prepare(
        'INSERT INTO seed (dataset, url, rank) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET rank = excluded.rank',
      );
      for (const [rank, { url }] of found.entries()) {
        insert.run(id, url, rank + 1);
      }
      this.#db
        .prepare(
          "UPDATE search SET state = 'done', error = NULL, at = ? WHERE dataset = ?",
        )
        .run(now(), id);
    });
  }

  searchFailed(id: string, error: string): void {
    this.#db
      .prepare(
        "UPDATE search SET state = 'failed', error = ?, at = ? WHERE dataset = ?",
      )
      .run(error, now(), id);
  }

  seeds(id: string): readonly z.infer<typeof seedRow>[] {
    return this.#db
      .prepare('SELECT * FROM seed WHERE dataset = ? ORDER BY rank')
      .all(id)
      .map((row) => seedRow.parse(row));
  }

  // The item of a page in a dataset: its id, given once, whether it met
  // every criterion and the fields at its last event.
  item(
    datasetId: string,
    articleUrl: string,
  ):
    | {
        readonly id: string;
        readonly matches: boolean;
        readonly fields: Fields;
      }
    | undefined {
    const row = this.#db
      .prepare(
        'SELECT id, matches, fields FROM item WHERE dataset = ? AND article_url = ?',
      )
      .get(datasetId, articleUrl);
    if (row === undefined) {
      return undefined;
    }
    const parsed = itemRow.parse(row);
    return {
      id: parsed.id,
      matches: parsed.matches === 1,
      fields: JSON.parse(parsed.fields),
    };
  }

  itemIds(datasetId: string): ReadonlyMap<string, string> {
    return new Map(
      this.#db
        .prepare('SELECT article_url, id FROM item WHERE dataset = ?')
        .all(datasetId)
        .map((row) => {
          const parsed = itemIdRow.parse(row);
          return [parsed.article_url, parsed.id] as const;
        }),
    );
  }

  saveItem(
    datasetId: string,
    articleUrl: string,
    { matches, fields }: { readonly matches: boolean; readonly fields: Fields },
  ): string {
    const id =
      this.item(datasetId, articleUrl)?.id ??
      `itm_${randomBytes(8).toString('hex')}`;
    this.#db
      .prepare(
        `INSERT INTO item (dataset, article_url, id, matches, fields) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (dataset, article_url) DO UPDATE SET matches = excluded.matches, fields = excluded.fields`,
      )
      .run(datasetId, articleUrl, id, matches ? 1 : 0, JSON.stringify(fields));
    return id;
  }

  // An event of a dataset or a monitor, by its id.
  append(resource: string, change: ItemChange | MonitorChange): void {
    this.#db
      .prepare(
        'INSERT INTO event (resource, type, data, previous, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(
        resource,
        change.type,
        JSON.stringify(change.data),
        'previous' in change && change.previous !== null
          ? JSON.stringify(change.previous)
          : null,
        now(),
      );
  }

  datasetEvents(
    id: string,
    cursor: string | undefined,
    limit: number,
  ): Events<ItemChange> {
    const page = this.#events(id, cursor, limit);
    return typeof page === 'string'
      ? page
      : {
          data: page.rows.map((row) => ({
            cursor: this.#cursor(row.seq),
            type: itemEventType.parse(row.type),
            data: JSON.parse(row.data),
            previous: row.previous === null ? null : JSON.parse(row.previous),
            createdAt: row.created_at,
          })),
          hasMore: page.hasMore,
          nextCursor: page.nextCursor,
        };
  }

  monitorEvents(
    id: string,
    cursor: string | undefined,
    limit: number,
  ): Events<MonitorChange> {
    const page = this.#events(id, cursor, limit);
    return typeof page === 'string'
      ? page
      : {
          data: page.rows.map((row) => ({
            cursor: this.#cursor(row.seq),
            type: monitorEventType.parse(row.type),
            data: JSON.parse(row.data),
            createdAt: row.created_at,
          })),
          hasMore: page.hasMore,
          nextCursor: page.nextCursor,
        };
  }

  failed(url: string, reason: string): void {
    this.#db
      .prepare(
        'INSERT INTO failure (url, reason, failed_at) VALUES (?, ?, ?) ON CONFLICT (url) DO UPDATE SET reason = excluded.reason, failed_at = excluded.failed_at',
      )
      .run(url, reason, now());
  }

  failures(): ReadonlyMap<string, { reason: string; failedAt: string }> {
    return new Map(
      this.#db
        .prepare('SELECT url, reason, failed_at FROM failure')
        .all()
        .map((row) => {
          const parsed = failureRow.parse(row);
          return [
            parsed.url,
            { reason: parsed.reason, failedAt: parsed.failed_at },
          ] as const;
        }),
    );
  }

  // The events of a dataset or a monitor after the cursor, oldest first, and
  // whether more follow. A cursor of an earlier log is gone; one that this
  // API never gave is invalid.
  #events(resource: string, cursor: string | undefined, limit: number) {
    const after = cursor === undefined ? 0 : this.#after(cursor);
    if (after === 'gone' || after === 'invalid') {
      return after;
    }
    const rows = this.#db
      .prepare(
        'SELECT * FROM event WHERE resource = ? AND seq > ? ORDER BY seq LIMIT ?',
      )
      .all(resource, after, limit + 1)
      .map((row) => eventRow.parse(row));
    const page = rows.slice(0, limit);
    return {
      rows: page,
      hasMore: rows.length > limit,
      nextCursor: this.#cursor(page.at(-1)?.seq ?? after),
    };
  }

  #cursor(seq: number): string {
    return Buffer.from(JSON.stringify({ epoch: this.#epoch, seq })).toString(
      'base64url',
    );
  }

  #after(cursor: string): number | 'gone' | 'invalid' {
    let parsed;
    try {
      parsed = cursorSchema.safeParse(
        JSON.parse(Buffer.from(cursor, 'base64url').toString()),
      );
    } catch (error) {
      if (error instanceof SyntaxError) {
        return 'invalid';
      }
      throw error;
    }
    if (!parsed.success) {
      return 'invalid';
    }
    return parsed.data.epoch === this.#epoch ? parsed.data.seq : 'gone';
  }
}

export default new Store(join(directory, 'api.sqlite'));
