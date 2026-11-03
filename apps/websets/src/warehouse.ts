import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { pollChanges } from '@zukhruf/async';
import { DataVersion } from '@zukhruf/sqlite-data-version';
import { openReader } from '@zukhruf/sqlite-reader';

import directory from './directory.ts';

// The SQLite file that elt fills: the pages, their evaluations and their
// fields.
export const warehousePath = join(directory, 'warehouse.sqlite');

// A first start has no file yet; elt fills the one this makes.
new DatabaseSync(warehousePath).close();

// The API reads the warehouse on a read-only connection.
export const sql = openReader(warehousePath).createTagStore();

// Each commit that elt makes, as the data version of the file shows it,
// checked every second; the first check is one, so a start reads what the
// warehouse holds.
export async function* commits(signal: AbortSignal): AsyncGenerator<void> {
  using version = new DataVersion(warehousePath);
  for await (const changed of pollChanges(
    new Map([['warehouse', async () => version.current]]),
    { interval: 1_000, signal, clock: globalThis },
  )) {
    if (changed.size > 0) {
      yield;
    }
  }
}
