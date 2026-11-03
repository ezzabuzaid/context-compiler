import { DatabaseSync, type SQLTagStore } from 'node:sqlite';
import { setTimeout } from 'node:timers/promises';

// The app's SQLite file that the alerts read, read only. A commit is any
// change another connection commits there, the copies' and the offer rule's,
// which PRAGMA data_version shows; SQLite tells a reader nothing, so it asks
// every second. The watch refreshes the offers after a pass, not before it
// yields the pass, so a commit of the pass alone would read the offers before
// it.
export class CreditsWarehouse implements Disposable {
  readonly sql: SQLTagStore;
  readonly #database: DatabaseSync;

  constructor(path: string) {
    // A first run has no file yet; elt fills the one this makes.
    new DatabaseSync(path).close();
    this.#database = new DatabaseSync(path, { readOnly: true });
    this.sql = this.#database.createTagStore();
  }

  async *commits(signal: AbortSignal): AsyncIterable<unknown> {
    let version = this.#version();
    for (;;) {
      await setTimeout(1000, undefined, { signal });
      const next = this.#version();
      if (next === version) continue;
      version = next;
      yield;
    }
  }

  #version() {
    return this.#database.prepare('PRAGMA data_version').get()?.data_version;
  }

  [Symbol.dispose]() {
    this.#database.close();
  }
}
