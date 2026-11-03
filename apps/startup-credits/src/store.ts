import { randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { Declaration } from '@zukhruf/sqlite-drift';
import { z } from 'zod';

import directory from './directory.ts';
import type { Found } from './search.ts';

export const criterionSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/u),
  description: z.string().trim().min(1).max(500),
});
export type Criterion = z.infer<typeof criterionSchema>;

// What the consumers asked for: their queries, and the pages that the search
// of each query found. No pipeline run can rebuild them, so a changed
// declaration keeps the rows.
const asked = new Declaration(
  [
    `CREATE TABLE query (
      id TEXT PRIMARY KEY,
      criteria TEXT NOT NULL,
      created_at TEXT NOT NULL,
      search TEXT NOT NULL CHECK (search IN ('pending', 'done', 'failed')),
      search_error TEXT,
      searched_at TEXT,
      CHECK ((search = 'failed') = (search_error IS NOT NULL)),
      CHECK ((search = 'pending') = (searched_at IS NULL))
    ) STRICT`,
    `CREATE TABLE seed (
      query TEXT NOT NULL REFERENCES query (id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      company TEXT NOT NULL,
      rank INTEGER NOT NULL,
      PRIMARY KEY (query, url)
    ) STRICT`,
  ],
  { rows: 'keep' },
);

// What the API told: the id it gave each program, and the offers and their
// values that its last event reported; the event log; the programs that each
// query matched; and why a seed did not load. A changed declaration starts a
// new log with a new epoch, so every cursor of the old log is gone.
const told = new Declaration(
  [
    'CREATE TABLE log (epoch TEXT NOT NULL) STRICT',
    `CREATE TABLE program (
      article_url TEXT PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      valued TEXT NOT NULL,
      offers TEXT NOT NULL
    ) STRICT`,
    `CREATE TABLE event (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      query TEXT,
      data TEXT NOT NULL,
      previous TEXT,
      created_at TEXT NOT NULL
    ) STRICT`,
    `CREATE TABLE match (
      query TEXT NOT NULL,
      program TEXT NOT NULL,
      PRIMARY KEY (query, program)
    ) STRICT`,
    `CREATE TABLE failure (
      url TEXT PRIMARY KEY,
      reason TEXT NOT NULL,
      failed_at TEXT NOT NULL
    ) STRICT`,
  ],
  { rows: 'replace' },
);

const queryRow = z.object({
  id: z.string(),
  criteria: z.string(),
  created_at: z.string(),
  search: z.enum(['pending', 'done', 'failed']),
  search_error: z.string().nullable(),
  searched_at: z.string().nullable(),
});
const seedRow = z.object({
  query: z.string(),
  url: z.string(),
  company: z.string(),
  rank: z.number(),
});
const eventRow = z.object({
  seq: z.number(),
  type: z.string(),
  query: z.string().nullable(),
  data: z.string(),
  previous: z.string().nullable(),
  created_at: z.string(),
});
const cursorSchema = z.object({ epoch: z.string(), seq: z.number().int() });

export type Query = {
  readonly id: string;
  readonly criteria: readonly Criterion[];
  readonly createdAt: string;
  readonly search:
    | { readonly state: 'pending' }
    | { readonly state: 'done'; readonly at: string }
    | { readonly state: 'failed'; readonly at: string; readonly error: string };
};
type Seed = z.infer<typeof seedRow>;
type Event = {
  readonly cursor: string;
  readonly type: string;
  readonly query: string | null;
  readonly data: unknown;
  readonly previous: unknown;
  readonly createdAt: string;
};

const id = (prefix: string) =>
  `${prefix}_${randomBytes(9).toString('base64url')}`;
const now = () => new Date().toISOString();

function query(row: unknown): Query {
  const parsed = queryRow.parse(row);
  return {
    id: parsed.id,
    criteria: z.array(criterionSchema).parse(JSON.parse(parsed.criteria)),
    createdAt: parsed.created_at,
    search:
      parsed.searched_at === null
        ? { state: 'pending' }
        : parsed.search_error === null
          ? { state: 'done', at: parsed.searched_at }
          : {
              state: 'failed',
              at: parsed.searched_at,
              error: parsed.search_error,
            },
  };
}

// The API's own file, api.sqlite, beside the warehouse that elt fills.
class Store {
  readonly #db: DatabaseSync;
  readonly #epoch: string;

  constructor(path: string) {
    this.#db = new DatabaseSync(path, { timeout: 5_000 });
    this.#db.exec('PRAGMA foreign_keys = ON');
    asked.apply(this.#db);
    told.apply(this.#db);
    const epoch = z
      .object({ epoch: z.string() })
      .optional()
      .parse(this.#db.prepare('SELECT epoch FROM log').get());
    this.#epoch = epoch?.epoch ?? randomUUID();
    if (epoch === undefined) {
      this.#db.prepare('INSERT INTO log (epoch) VALUES (?)').run(this.#epoch);
    }
  }

  // Runs the writes of one change together, so a reader never sees an event
  // without the state that it reports.
  transaction<T>(write: () => T): T {
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const value = write();
      this.#db.exec('COMMIT');
      return value;
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
  }

  addQuery(criteria: readonly Criterion[]): Query {
    const added = id('qry');
    this.#db
      .prepare(
        "INSERT INTO query (id, criteria, created_at, search) VALUES (?, ?, ?, 'pending')",
      )
      .run(added, JSON.stringify(criteria), now());
    return this.query(added)!;
  }

  queries(): readonly Query[] {
    return this.#db
      .prepare('SELECT * FROM query ORDER BY created_at, id')
      .all()
      .map(query);
  }

  query(queryId: string): Query | undefined {
    const row = this.#db
      .prepare('SELECT * FROM query WHERE id = ?')
      .get(queryId);
    return row === undefined ? undefined : query(row);
  }

  // The query and its seeds and matches go; its events stay in the log.
  deleteQuery(queryId: string): void {
    this.transaction(() => {
      this.#db.prepare('DELETE FROM match WHERE query = ?').run(queryId);
      this.#db.prepare('DELETE FROM query WHERE id = ?').run(queryId);
    });
  }

  searched(queryId: string, found: readonly Found[]): void {
    this.transaction(() => {
      const insert = this.#db.prepare(
        'INSERT OR IGNORE INTO seed (query, url, company, rank) VALUES (?, ?, ?, ?)',
      );
      for (const [rank, { url, company }] of found.entries()) {
        insert.run(queryId, url, company, rank + 1);
      }
      this.#db
        .prepare(
          "UPDATE query SET search = 'done', searched_at = ? WHERE id = ?",
        )
        .run(now(), queryId);
    });
  }

  searchFailed(queryId: string, error: string): void {
    this.#db
      .prepare(
        "UPDATE query SET search = 'failed', search_error = ?, searched_at = ? WHERE id = ?",
      )
      .run(error, now(), queryId);
  }

  seeds(queryId?: string): readonly Seed[] {
    return (
      queryId === undefined
        ? this.#db.prepare('SELECT * FROM seed ORDER BY query, rank').all()
        : this.#db
            .prepare('SELECT * FROM seed WHERE query = ? ORDER BY rank')
            .all(queryId)
    ).map((row) => seedRow.parse(row));
  }

  // The starting URLs and the criteria that the queries give the crawl, each
  // once: two queries that found one page, or ask one thing, share it.
  configuration(): {
    readonly seeds: readonly string[];
    readonly criteria: readonly string[];
  } {
    return {
      seeds: [...new Set(this.seeds().map(({ url }) => url))].toSorted(),
      criteria: [
        ...new Set(
          this.queries().flatMap(({ criteria }) =>
            criteria.map(({ description }) => description),
          ),
        ),
      ].toSorted(),
    };
  }

  // The id of a program, given once, and the offers and their values that
  // its last event reported.
  program(articleUrl: string):
    | {
        readonly id: string;
        readonly valued: readonly string[];
        readonly offers: unknown;
      }
    | undefined {
    const row = z
      .object({ id: z.string(), valued: z.string(), offers: z.string() })
      .optional()
      .parse(
        this.#db
          .prepare(
            'SELECT id, valued, offers FROM program WHERE article_url = ?',
          )
          .get(articleUrl),
      );
    return row === undefined
      ? undefined
      : {
          id: row.id,
          valued: z.array(z.string()).parse(JSON.parse(row.valued)),
          offers: JSON.parse(row.offers),
        };
  }

  programIds(): ReadonlyMap<string, string> {
    return new Map(
      this.#db
        .prepare('SELECT article_url, id FROM program')
        .all()
        .map((row) => {
          const { article_url, id: programId } = z
            .object({ article_url: z.string(), id: z.string() })
            .parse(row);
          return [article_url, programId] as const;
        }),
    );
  }

  addProgram(
    articleUrl: string,
    valued: readonly string[],
    offers: unknown,
  ): string {
    const added = id('prg');
    this.#db
      .prepare(
        'INSERT INTO program (article_url, id, valued, offers) VALUES (?, ?, ?, ?)',
      )
      .run(articleUrl, added, JSON.stringify(valued), JSON.stringify(offers));
    return added;
  }

  changeProgram(
    articleUrl: string,
    valued: readonly string[],
    offers: unknown,
  ): void {
    this.#db
      .prepare(
        'UPDATE program SET valued = ?, offers = ? WHERE article_url = ?',
      )
      .run(JSON.stringify(valued), JSON.stringify(offers), articleUrl);
  }

  append(event: {
    readonly type: string;
    readonly query: string | null;
    readonly data: unknown;
    readonly previous: unknown;
  }): void {
    this.#db
      .prepare(
        'INSERT INTO event (type, query, data, previous, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(
        event.type,
        event.query,
        JSON.stringify(event.data),
        event.previous === null ? null : JSON.stringify(event.previous),
        now(),
      );
  }

  // The events after the cursor, oldest first, of the programs (query null)
  // or of one query, and the cursor after the last of them. A cursor of an
  // earlier log is gone; one that this API never gave is invalid.
  events(
    queryId: string | null,
    cursor: string | undefined,
    limit: number,
  ):
    | { readonly events: readonly Event[]; readonly next: string }
    | 'gone'
    | 'invalid' {
    const after = cursor === undefined ? 0 : this.#after(cursor);
    if (after === 'gone' || after === 'invalid') {
      return after;
    }
    const events = this.#db
      .prepare(
        'SELECT * FROM event WHERE seq > ? AND query IS ? ORDER BY seq LIMIT ?',
      )
      .all(after, queryId, limit)
      .map((row) => {
        const parsed = eventRow.parse(row);
        return {
          cursor: this.#cursor(parsed.seq),
          type: parsed.type,
          query: parsed.query,
          data: JSON.parse(parsed.data),
          previous:
            parsed.previous === null ? null : JSON.parse(parsed.previous),
          createdAt: parsed.created_at,
        };
      });
    return { events, next: events.at(-1)?.cursor ?? this.#cursor(after) };
  }

  matches(queryId: string): ReadonlySet<string> {
    return new Set(
      this.#db
        .prepare('SELECT program FROM match WHERE query = ?')
        .all(queryId)
        .map((row) => z.object({ program: z.string() }).parse(row).program),
    );
  }

  match(queryId: string, programId: string): void {
    this.#db
      .prepare('INSERT INTO match (query, program) VALUES (?, ?)')
      .run(queryId, programId);
  }

  unmatch(queryId: string, programId: string): void {
    this.#db
      .prepare('DELETE FROM match WHERE query = ? AND program = ?')
      .run(queryId, programId);
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
          const parsed = z
            .object({
              url: z.string(),
              reason: z.string(),
              failed_at: z.string(),
            })
            .parse(row);
          return [
            parsed.url,
            { reason: parsed.reason, failedAt: parsed.failed_at },
          ] as const;
        }),
    );
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
