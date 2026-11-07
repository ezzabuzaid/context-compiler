import type { DatabaseSync } from 'node:sqlite';

import { open } from '@zukhruf/sqlite-open';
import { z } from 'zod';

import type { Definition } from '../dataset.ts';

const datasetRow = z.object({ id: z.string(), definition: z.string() });
const seedRow = z.object({ dataset: z.string(), url: z.string() });

// A dataset as a pass reads it: what it asks, and the pages that its search
// found.
export type Asked = Definition & {
  readonly id: string;
  readonly seeds: readonly string[];
};

// One read of what the consumers asked, on its own read-only connection to
// api.sqlite, in one read transaction, so the streams of a pass agree.
export class DefinitionsScan implements AsyncDisposable {
  readonly #db: DatabaseSync;

  constructor(path: string) {
    this.#db = open(path, { readOnly: true });
    this.#db.exec('BEGIN');
  }

  *datasets(): Generator<Asked> {
    const seeds = Map.groupBy(
      this.#db
        .prepare('SELECT dataset, url FROM seed ORDER BY dataset, rank')
        .all()
        .map((row) => seedRow.parse(row)),
      ({ dataset }) => dataset,
    );
    for (const row of this.#db
      .prepare('SELECT id, definition FROM dataset ORDER BY id')
      .iterate()) {
      const { id, definition } = datasetRow.parse(row);
      // As the store keeps it, after the route validated it.
      const asked: Definition = JSON.parse(definition);
      yield {
        ...asked,
        id,
        seeds: (seeds.get(id) ?? []).map(({ url }) => url),
      };
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    this.#db.exec('COMMIT');
    this.#db.close();
  }
}
