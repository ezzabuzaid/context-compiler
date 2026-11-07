import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { Federation } from '@zukhruf/sqlite-federation';
import { open } from '@zukhruf/sqlite-open';

import type { Evidence } from '../contracts/evidence.ts';

// Reads the published settings view, not Settings (whose constructor writes).
export class Warehouse {
  readonly #root: string;
  constructor(root: string) {
    this.#root = root;
  }

  get settingsPath(): string {
    return join(this.#root, 'settings.sqlite');
  }

  sources(): { name: string; database: string; error: string | null }[] {
    using db = open(this.settingsPath, { readOnly: true });
    return db
      .prepare(
        'SELECT connector,database,connection_error FROM selected_connectors',
      )
      .all()
      .map((row) => ({
        name: String(row.connector),
        database: join(this.#root, String(row.database)),
        error:
          row.connection_error === null ? null : String(row.connection_error),
      }));
  }

  query(sql: string): Evidence[] {
    const sources = this.sources();
    // Every attached database is read-only. No shell, writes, or source refresh.
    using db = new Federation({
      main: ':memory:',
      locate: (name) => sources.find((item) => item.name === name)?.database,
      timeout: 3000,
      // The imports keep integers above 2^53, such as Chromium task ids.
      readBigInts: true,
    });
    const result = db.query(sql);
    return result.rows.slice(0, 20).map((row) => {
      // The model reads JSON, which has no bigint: the digits keep the value.
      const data = Object.fromEntries(
        result.columns.map((column, at) => {
          const value = row[at];
          return [column, typeof value === 'bigint' ? String(value) : value];
        }),
      );
      const serialized = JSON.stringify(data);
      if (serialized.length > 12_000)
        throw new Error(
          'A warehouse row exceeds the context budget. Select fewer columns or use substr.',
        );
      return {
        id: `warehouse:${createHash('sha256').update(sql).update(serialized).digest('hex')}`,
        source: sql,
        data,
      };
    });
  }
}
