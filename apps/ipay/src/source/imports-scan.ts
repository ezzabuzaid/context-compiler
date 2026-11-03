import { readFileSync } from 'node:fs';
import { findPackageJSON } from 'node:module';
import { dirname, join } from 'node:path';

import { Snapshot } from '@zukhruf/sqlite-snapshot';

import type { ImportConnector } from '../imports.ts';

// Mail's own model of a message as its reader sees it, the mail_messages
// preset the Mail connector keeps in its presets folder.
const mailMessages = readFileSync(
  join(
    dirname(
      findPackageJSON('@workspace/connector-apple-mail', import.meta.url)!,
    ),
    'presets/mail_messages.sql',
  ),
  'utf8',
);

// One pass's read of the imports: each import is read at one moment, opened
// when a stream first reads it, so the tables of one import agree.
export class ImportsScan implements AsyncDisposable {
  readonly #paths: Readonly<Record<ImportConnector, string>>;
  readonly #snapshots = new Map<ImportConnector, Snapshot>();

  constructor(paths: Readonly<Record<ImportConnector, string>>) {
    this.#paths = paths;
  }

  snapshot(connector: ImportConnector): Snapshot {
    const open = this.#snapshots.get(connector);
    if (open !== undefined) return open;
    const snapshot = new Snapshot(this.#paths[connector]);
    this.#snapshots.set(connector, snapshot);
    if (connector === 'mail') {
      // The preset is a temporary view: the import stays as Mail left it.
      snapshot.all('PRAGMA temp_store = MEMORY');
      snapshot.all(mailMessages);
    }
    return snapshot;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    for (const snapshot of this.#snapshots.values()) snapshot[Symbol.dispose]();
  }
}
