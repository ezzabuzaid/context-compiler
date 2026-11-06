import { join } from 'node:path';

import { ChangeWatcher } from '@zukhruf/async';
import { DataVersion } from '@zukhruf/sqlite-data-version';
import { open } from '@zukhruf/sqlite-open';

import directory from './directory.ts';

// The SQLite file that elt fills: the pages, their evaluations and their
// fields.
export const warehousePath = join(directory, 'warehouse.sqlite');

// A first start has no file yet; elt fills the one this makes.
open(warehousePath).close();

// The API reads the warehouse on a read-only connection.
export const sql = open(warehousePath, { readOnly: true }).createTagStore();

// Each commit that elt makes, as the data version of the file shows it,
// checked every second; the first check is one, so a start reads what the
// warehouse holds. The read is local, so a check that takes the whole
// interval is stuck.
export async function* commits(signal: AbortSignal): AsyncGenerator<void> {
  using version = new DataVersion(warehousePath);
  const watcher = new ChangeWatcher([version], {
    interval: 1_000,
    timeout: 1_000,
    clock: globalThis,
  });
  for await (const outcomes of watcher.watch(signal)) {
    for (const outcome of outcomes.values()) {
      if (outcome.state === 'failed') throw outcome.error;
      if (outcome.state === 'changed') yield;
    }
  }
}
