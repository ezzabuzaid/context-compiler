import { hash } from 'node:crypto';
import { chmodSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { DataVersion } from '@zukhruf/sqlite-data-version';
import { Declaration } from '@zukhruf/sqlite-drift';
import { PersistentWriteAheadLog, open } from '@zukhruf/sqlite-open';
import { transaction } from '@zukhruf/sqlite-transaction';

import type { FailureType } from '@eltjs/elt';
import { installSQLiteCatalog, publishSQLiteViews } from '@eltjs/elt-sqlite';

import {
  type ConnectorFacts,
  type Selection,
  selectionProblems,
} from './selection.ts';

// How long a connection waits out another process writing the settings.
const writerWaitMs = 30_000;

// How often an import that is running checks that the user still selects it,
// as Airbyte's worker sends a heartbeat to learn its sync was cancelled.
const heartbeatMs = 1_000;

// Tables another version declared otherwise are replaced, and the selection
// they held is lost: stored settings are disposable, so the user sets up again.
// A selection and a failure name their import by its folder relative to the
// root, so a store moved to another folder still names its imports.
const settingsTables = new Declaration(
  [
    'CREATE TABLE selections (position INTEGER PRIMARY KEY, connector TEXT NOT NULL UNIQUE, scope TEXT NOT NULL, include_attachments INTEGER NOT NULL, directory TEXT NOT NULL, permissions TEXT NOT NULL)',
    "CREATE TABLE connection_failures (directory TEXT PRIMARY KEY, error TEXT NOT NULL, failure_type TEXT NOT NULL CHECK (failure_type IN ('config', 'system')), failed_at TEXT NOT NULL)",
    'CREATE TABLE watched (connector TEXT PRIMARY KEY)',
    'CREATE TABLE transcription (id INTEGER PRIMARY KEY CHECK (id = 1), model TEXT NOT NULL)',
  ],
  { rows: 'replace' },
);

// Where a connector's import lives: one directory per selection, so a pass
// still writing an earlier selection never touches the current one.
export function importDirectory(root: string, selection: Selection): string {
  return join(root, importFolder(selection));
}

// An import's folder in its connector's folder is named by the first hex
// digits of the SHA-256 of its selection.
const keyDigits = 16;
const importKey = new RegExp(`^[0-9a-f]{${keyDigits}}$`);

function importFolder(selection: Selection): string {
  const key = hash(
    'sha256',
    JSON.stringify([selection.scope, selection.includeAttachments]),
  ).slice(0, keyDigits);
  return join(selection.connector, key);
}

// Why a connector's import failed in a way its sync history in data.sqlite
// cannot record, and whose that is to fix: the import never connected, or the
// history itself could not install or record.
type ConnectionFailure = {
  error: string;
  failedAt: string;
  failureType: FailureType;
};

// The reason a running import stops when the user removes its connector.
export class ConnectorRemovedError extends Error {
  override name = 'ConnectorRemovedError';

  constructor(connector: string) {
    super(`${connector} was removed from the selection`);
  }
}

// What readers of the settings file see: one row per selected connector, with
// where its import lives and why it last failed in a way its history cannot record.
const selectedConnectors = {
  name: 'selected_connectors',
  description:
    'The connectors the user chose to import, in the order chosen. A connector missing here is not imported. Each import is its own SQLite file: open database to read its records, catalog and sync_status.',
  columns: {
    connector: 'Connector name, such as mail, notes or messages.',
    scope:
      'JSON of the chosen accounts (accountIds), collections (collectionIds) and dates (startAt inclusive, endAt exclusive); an absent key means all.',
    include_attachments:
      '1 when attachment bytes are copied beside the records, 0 for metadata only.',
    database:
      'Path of the SQLite file the import loads, relative to the folder that holds this settings file. It may not exist yet while the first import starts.',
    connection_error:
      'Why the import last failed in a way sync_status cannot record, such as missing macOS access or a database it could not write; NULL when sync_status has the outcome. A connector with an error is inaccessible, not empty.',
    connection_failure_type:
      'config when the user can fix connection_error by giving access or changing what they set up, and permissions says how; system for any other reason; NULL when sync_status has the outcome.',
    connection_failed_at:
      'When the import last failed in a way sync_status cannot record, as an ISO 8601 UTC timestamp; NULL when sync_status has the outcome.',
    permissions: 'What the user can do in macOS to give access to this app.',
  },
  query: `SELECT s."connector", s."scope", s."include_attachments", s."directory" || '/data.sqlite' AS "database",
      f."error" AS "connection_error", f."failure_type" AS "connection_failure_type", f."failed_at" AS "connection_failed_at", s."permissions"
    FROM "selections" s LEFT JOIN "connection_failures" f ON f."directory" = s."directory"
    ORDER BY s."position"`,
};

// One host's settings under root: settings.sqlite holds the selection and each
// import's connection failure, and readers find the imports through its
// selected_connectors view; each import lives in its own directory beside it.
export class Settings implements Disposable {
  readonly root: string;
  private readonly settings: DatabaseSync;

  constructor(root: string) {
    this.root = root;
    mkdirSync(root, { recursive: true, mode: 0o700 });
    chmodSync(root, 0o700);
    const path = this.#path;
    // Agents read settings.sqlite with sqlite3 -readonly in a sandbox that
    // cannot write this folder, so its -wal and -shm files stay at the close.
    this.settings = open(path, {
      timeout: writerWaitMs,
      journal: new PersistentWriteAheadLog(),
    });
    try {
      chmodSync(path, 0o600);
      const built = settingsTables.drift(this.settings) !== 'fits';
      settingsTables.apply(this.settings);
      // Readers find selected_connectors before anything is selected.
      if (built) this.#publish();
    } catch (error) {
      this.settings.close();
      throw error;
    }
  }

  get #path(): string {
    return join(this.root, 'settings.sqlite');
  }

  selections(): Selection[] {
    return this.settings
      .prepare(
        'SELECT connector, scope, include_attachments FROM selections ORDER BY position',
      )
      .all()
      .map((row) => ({
        connector: String(row.connector),
        scope: JSON.parse(String(row.scope)),
        includeAttachments: row.include_attachments === 1,
      }));
  }

  // The transcription model the user chose, by its file name: the hosts find
  // the file on whichever Mac reads the store.
  transcription(): string | null {
    const row = this.settings
      .prepare('SELECT model FROM transcription WHERE id = 1')
      .get();
    if (row === undefined) return null;
    if (typeof row.model !== 'string')
      throw new TypeError('Invalid stored transcription model');
    return row.model;
  }

  setTranscription(model: string | null): void {
    if (model === null) this.settings.exec('DELETE FROM transcription');
    else
      this.settings
        .prepare(
          'INSERT INTO transcription VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET model = excluded.model',
        )
        .run(model);
  }

  // The selected connectors the user keeps current, in the order chosen. A
  // narrowed connector stays kept current; a disconnected one is forgotten.
  watched(): string[] {
    return this.settings
      .prepare(
        'SELECT connector FROM watched JOIN selections USING (connector) ORDER BY position',
      )
      .all()
      .map(({ connector }) => String(connector));
  }

  // Keeps a selected connector current; one not selected stays as it is.
  watch(connector: string): void {
    this.settings
      .prepare(
        'INSERT OR IGNORE INTO watched SELECT connector FROM selections WHERE connector = ?',
      )
      .run(connector);
  }

  unwatch(connector: string): void {
    this.settings
      .prepare('DELETE FROM watched WHERE connector = ?')
      .run(connector);
  }

  // Saves a selection that has no problems, with what macOS needs granted for
  // each connector, forgets the failures of every other import and publishes
  // what readers see. The imports it no longer names are left stale.
  select<Selected extends Selection>(
    selections: readonly Selected[],
    {
      facts,
      permissions,
    }: {
      facts: (connector: string) => ConnectorFacts;
      permissions: (selection: Selected) => string;
    },
  ): void {
    const problems = selectionProblems(selections, facts);
    if (problems.length > 0) throw new Error(problems.join('\n'));
    transaction(
      this.settings,
      () => {
        this.settings.exec('DELETE FROM selections');
        const insert = this.settings.prepare(
          'INSERT INTO selections VALUES(?,?,?,?,?,?)',
        );
        for (const [position, selection] of selections.entries())
          insert.run(
            position,
            selection.connector,
            JSON.stringify(selection.scope),
            selection.includeAttachments ? 1 : 0,
            importFolder(selection),
            permissions(selection),
          );
        this.settings.exec(
          'DELETE FROM connection_failures WHERE directory NOT IN (SELECT directory FROM selections)',
        );
        this.settings.exec(
          'DELETE FROM watched WHERE connector NOT IN (SELECT connector FROM selections)',
        );
      },
      { mode: 'immediate' },
    );
    this.#publish();
  }

  // Every import directory but the selected one of each connector, including
  // those of connectors no longer selected. A host removes each once no pass
  // runs it, since a pass keeps its locks inside. Only a folder named as
  // importFolder names one is an import: the hosts' single flight keeps its
  // key locks in a folder of root too, and removing one while a process uses
  // root lets a second leader run the same key.
  staleImports(): string[] {
    const kept = new Set(
      this.selections().map((selection) => this.directory(selection)),
    );
    return readdirSync(this.root, { withFileTypes: true })
      .filter((connector) => connector.isDirectory())
      .flatMap((connector) =>
        readdirSync(join(this.root, connector.name))
          .filter((entry) => importKey.test(entry))
          .map((entry) => join(this.root, connector.name, entry)),
      )
      .filter((directory) => !kept.has(directory));
  }

  // Aborts with ConnectorRemovedError once the selection no longer names this
  // import. It reads the settings again only when the data version says a
  // connection committed, on each heartbeat of clock: an app gives globalThis.
  // The data version's connection runs no other query (its ADR 0001), and it
  // sees the commits of this store's connection too, so the selection reads
  // here. Every host keeps its Settings open past the end of the import.
  removal(
    selection: Selection,
    clock: {
      setTimeout(callback: () => void, ms: number): unknown;
      clearTimeout(timer: unknown): void;
    },
  ): Disposable & { readonly signal: AbortSignal } {
    const folder = importFolder(selection);
    const selected = this.settings.prepare(
      'SELECT 1 FROM selections WHERE directory = ?',
    );
    const held = new DisposableStack();
    const version = held.use(new DataVersion(this.#path));
    const controller = new AbortController();
    controller.signal.addEventListener('abort', () => held.dispose(), {
      once: true,
    });
    let seen: number | undefined;
    // A timer's error would end the process; the import stops with it instead.
    const check = () => {
      try {
        const current = version.current;
        if (current === seen) return;
        seen = current;
        if (selected.get(folder) === undefined)
          controller.abort(new ConnectorRemovedError(selection.connector));
      } catch (error) {
        controller.abort(error);
      }
    };
    let heartbeat: unknown;
    held.defer(() => clock.clearTimeout(heartbeat));
    const beat = () => {
      check();
      if (!controller.signal.aborted)
        heartbeat = clock.setTimeout(beat, heartbeatMs);
    };
    beat();
    return {
      signal: controller.signal,
      [Symbol.dispose]: () => held.dispose(),
    };
  }

  // Publishes selected_connectors and the catalog listing it; safe to repeat.
  #publish() {
    publishSQLiteViews(this.settings, { views: [selectedConnectors] });
    installSQLiteCatalog({ path: this.#path });
  }

  directory(selection: Selection): string {
    return importDirectory(this.root, selection);
  }

  database(selection: Selection): string {
    return join(this.directory(selection), 'data.sqlite');
  }

  connectionFailure(selection: Selection): ConnectionFailure | undefined {
    const row = this.settings
      .prepare(
        'SELECT error, failure_type, failed_at FROM connection_failures WHERE directory=?',
      )
      .get(importFolder(selection));
    return row === undefined
      ? undefined
      : {
          error: String(row.error),
          failedAt: String(row.failed_at),
          failureType: row.failure_type === 'config' ? 'config' : 'system',
        };
  }

  saveConnectionFailure(
    selection: Selection,
    error: string,
    failureType: FailureType,
  ) {
    this.settings
      .prepare(
        "INSERT INTO connection_failures (directory, error, failure_type, failed_at) VALUES(?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(directory) DO UPDATE SET error=excluded.error, failure_type=excluded.failure_type, failed_at=excluded.failed_at",
      )
      .run(importFolder(selection), error, failureType);
  }

  clearConnectionFailure(selection: Selection) {
    this.settings
      .prepare('DELETE FROM connection_failures WHERE directory=?')
      .run(importFolder(selection));
  }

  [Symbol.dispose]() {
    this.settings.close();
  }
}
