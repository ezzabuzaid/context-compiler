import type { SQLTagStore } from 'node:sqlite';

import {
  type SnapshotChange,
  SnapshotDifferential,
  type SnapshotDifferentialOptions,
  type SnapshotState,
} from '@zukhruf/snapshot-differential';

// Rows of a table that the first pass makes, and none before it.
export function rows(read: () => Record<string, unknown>[]) {
  try {
    return read();
  } catch (error) {
    if (Error.isError(error) && /^no such table/u.test(error.message))
      return [];
    throw error;
  }
}

// A record that is new, or a record whose key the alert read before with
// other values.
export type Change<Data> = Extract<
  SnapshotChange<Data, SnapshotState>,
  { readonly type: 'insert' | 'update' }
>;

// One kind of line that the app logs. At each commit, an alert reads its
// records from the store, compares them by key with what it read at the
// commit before (a snapshot differential), and logs the changes it reports.
// An alert that throws keeps what it read before, so the next commit compares
// again and it loses nothing.
export abstract class Alert<Data extends Record<string, unknown>> {
  readonly #differential: SnapshotDifferential<Data>;
  // null until the baseline: the differential reads null as a first scan.
  #state: SnapshotState | null = null;

  constructor(options: SnapshotDifferentialOptions<Data>) {
    this.#differential = new SnapshotDifferential(options);
  }

  protected abstract records(sql: SQLTagStore): readonly Data[];

  protected abstract line(change: Change<Data>): string | null;

  // What the store holds now, read and not logged.
  async baseline(sql: SQLTagStore): Promise<void> {
    await Array.fromAsync(this.lines(sql));
  }

  async *lines(sql: SQLTagStore): AsyncGenerator<string> {
    for await (const change of this.#differential.diff(
      this.records(sql),
      this.#state,
    )) {
      if (change.type === 'state') this.#state = change.state;
      else if (change.type !== 'delete') {
        const line = this.line(change);
        if (line !== null) yield line;
      }
    }
  }
}
