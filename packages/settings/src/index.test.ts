import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';

import { PersistentWriteAheadLog, open } from '@zukhruf/sqlite-open';
import { TemporaryFiles } from '@zukhruf/testing/fs';

import {
  type ConnectorFacts,
  ConnectorRemovedError,
  type Selection,
  Settings,
  selectionProblems,
} from './index.ts';

// Notes narrows by account and folder and is dated; Contacts narrows by
// container only and has no dates; Books cannot be narrowed.
const facts = (connector: string): ConnectorFacts => ({
  narrowsBy: (kind) =>
    connector === 'notes' ||
    (connector === 'contacts' && kind === 'collectionIds'),
  datedBy: connector === 'notes' ? 'last modified' : null,
});
const options = {
  facts,
  permissions: ({ connector }: Selection) => `Allow ${connector}.`,
};

// The sqlite3 shell agents read with, refused writes and untrusted schemas.
function shell(database: string, sql: string) {
  const { stdout, stderr } = spawnSync(
    '/usr/bin/sqlite3',
    ['-readonly', '-json', database, sql],
    { encoding: 'utf8' },
  );
  return { rows: JSON.parse(stdout || '[]'), stderr };
}

test('a selection is checked against what each connector can be narrowed by', () => {
  assert.deepEqual(
    selectionProblems(
      [
        { connector: 'notes', scope: {}, includeAttachments: true },
        { connector: 'notes', scope: {}, includeAttachments: false },
        {
          connector: 'contacts',
          scope: {
            accountIds: ['a'],
            collectionIds: ['c', 'c'],
            startAt: '2025-01-01T00:00:00.000Z',
          },
          includeAttachments: true,
        },
        {
          connector: 'books',
          scope: { collectionIds: [] },
          includeAttachments: true,
        },
        {
          connector: 'notes',
          scope: {
            startAt: '2025-02-01T00:00:00.000Z',
            endAt: '2025-01-01T00:00:00.000Z',
          },
          includeAttachments: true,
        },
      ],
      facts,
    ),
    [
      'notes: choose each connector once',
      'contacts: cannot be narrowed by account IDs',
      'contacts: choose each collection once',
      'contacts: date filtering is unavailable',
      'books: cannot be narrowed by collection IDs',
      'books: choose at least one collection',
      'notes: choose each connector once',
      'notes: start must precede end',
    ],
  );
  assert.deepEqual(
    selectionProblems(
      [
        {
          connector: 'notes',
          scope: { accountIds: ['a'], startAt: '2025-01-01T00:00:00.000Z' },
          includeAttachments: true,
        },
      ],
      facts,
    ),
    [],
  );
});

test('readers find each selected import, where it lives and what access it needs in selected_connectors with the sqlite3 shell', async () => {
  await using scratch = await new TemporaryFiles().directory('store-');
  const notes = {
    connector: 'notes',
    scope: { collectionIds: ['folder-1'] },
    includeAttachments: false,
  };
  {
    using store = new Settings(scratch.path);
    store.select(
      [notes, { connector: 'books', scope: {}, includeAttachments: true }],
      options,
    );
    store.saveConnectionFailure(notes, 'Notes could not be opened.', 'config');
  }

  const { rows, stderr } = shell(
    join(scratch.path, 'settings.sqlite'),
    'SELECT connector, scope, include_attachments, database, connection_error, connection_failure_type, permissions FROM selected_connectors',
  );

  assert.equal(stderr, '');
  using store = new Settings(scratch.path);
  assert.deepEqual(rows, [
    {
      connector: 'notes',
      scope: '{"collectionIds":["folder-1"]}',
      include_attachments: 0,
      database: relative(scratch.path, store.database(notes)),
      connection_error: 'Notes could not be opened.',
      connection_failure_type: 'config',
      permissions: 'Allow notes.',
    },
    {
      connector: 'books',
      scope: '{}',
      include_attachments: 1,
      database: relative(
        scratch.path,
        store.database({
          connector: 'books',
          scope: {},
          includeAttachments: true,
        }),
      ),
      connection_error: null,
      connection_failure_type: null,
      permissions: 'Allow books.',
    },
  ]);
  assert.deepEqual(
    shell(
      join(scratch.path, 'settings.sqlite'),
      "SELECT name FROM catalog WHERE name = 'selected_connectors.database'",
    ).rows,
    [{ name: 'selected_connectors.database' }],
  );
});

test(
  'settings.sqlite and its -wal and -shm files are readable by their owner only',
  { skip: process.platform === 'win32' },
  async () => {
    await using scratch = await new TemporaryFiles().directory('store-');
    using store = new Settings(scratch.path);
    store.select(
      [{ connector: 'notes', scope: {}, includeAttachments: true }],
      options,
    );

    const modes = ['', '-wal', '-shm'].map(
      (suffix) =>
        statSync(join(scratch.path, `settings.sqlite${suffix}`)).mode & 0o777,
    );

    assert.deepEqual(modes, [0o600, 0o600, 0o600]);
  },
);

test(
  'after the settings close, a reader that cannot write their folder reads the selection',
  {
    skip: process.platform === 'win32' || process.getuid?.() === 0,
  },
  async () => {
    await using scratch = await new TemporaryFiles().directory('store-');
    {
      using store = new Settings(scratch.path);
      store.select(
        [{ connector: 'notes', scope: {}, includeAttachments: true }],
        options,
      );
    }
    chmodSync(scratch.path, 0o555);
    try {
      using reader = open(join(scratch.path, 'settings.sqlite'), {
        readOnly: true,
      });

      const connectors = reader
        .prepare('SELECT connector FROM selected_connectors')
        .all()
        .map(({ connector }) => connector);

      assert.deepEqual(connectors, ['notes']);
    } finally {
      chmodSync(scratch.path, 0o700);
    }
  },
);

test('a store moved to another folder still names its imports, their failures and their databases', async () => {
  await using scratch = await new TemporaryFiles().directory('store-');
  const notes = { connector: 'notes', scope: {}, includeAttachments: true };
  const before = join(scratch.path, 'before');
  const after = join(scratch.path, 'after');
  {
    using store = new Settings(before);
    store.select([notes], options);
    store.saveConnectionFailure(notes, 'Notes could not be opened.', 'config');
  }
  renameSync(before, after);

  using moved = new Settings(after);
  using removal = moved.removal(notes, globalThis);
  const { rows } = shell(
    join(after, 'settings.sqlite'),
    'SELECT database FROM selected_connectors',
  );

  assert.equal(removal.signal.aborted, false);
  assert.equal(
    moved.connectionFailure(notes)?.error,
    'Notes could not be opened.',
  );
  assert.deepEqual(rows, [
    { database: relative(after, moved.database(notes)) },
  ]);
});

test('readers find selected_connectors empty in a new store and in one whose tables another version declared otherwise, before anything is selected', async () => {
  await using scratch = await new TemporaryFiles().directory('store-');
  const settings = join(scratch.path, 'settings.sqlite');
  const selected = () =>
    shell(settings, 'SELECT connector FROM selected_connectors');

  new Settings(scratch.path)[Symbol.dispose]();
  const fresh = selected();
  {
    using store = new Settings(scratch.path);
    store.select(
      [{ connector: 'notes', scope: {}, includeAttachments: true }],
      options,
    );
  }
  {
    using database = open(settings, { journal: new PersistentWriteAheadLog() });
    database.exec(`DROP TABLE connection_failures;
      CREATE TABLE connection_failures (directory TEXT PRIMARY KEY, error TEXT NOT NULL)`);
  }
  new Settings(scratch.path)[Symbol.dispose]();
  const rebuilt = selected();

  assert.deepEqual(fresh, { rows: [], stderr: '' });
  assert.deepEqual(rebuilt, { rows: [], stderr: '' });
});

test('a changed selection leaves its previous import stale, and a selection with problems changes nothing', async () => {
  await using scratch = await new TemporaryFiles().directory('store-');
  using store = new Settings(scratch.path);
  const everything = {
    connector: 'notes',
    scope: {},
    includeAttachments: true,
  };
  store.select([everything], options);
  mkdirSync(store.directory(everything), { recursive: true });

  assert.throws(
    () =>
      store.select(
        [
          {
            connector: 'books',
            scope: { accountIds: ['a'] },
            includeAttachments: true,
          },
        ],
        options,
      ),
    /books: cannot be narrowed by account IDs/,
  );
  assert.deepEqual(store.selections(), [everything]);
  assert.deepEqual(store.staleImports(), []);

  const metadata = { ...everything, includeAttachments: false };
  store.select([metadata], options);
  mkdirSync(store.directory(metadata), { recursive: true });
  assert.deepEqual(store.selections(), [metadata]);
  assert.deepEqual(store.staleImports(), [store.directory(everything)]);
  store.select([], options);
  assert.deepEqual(
    store.staleImports().sort(),
    [store.directory(everything), store.directory(metadata)].sort(),
  );
});

test('a connector the user keeps current stays so when narrowed, until it is switched off or disconnected', async () => {
  await using scratch = await new TemporaryFiles().directory('store-');
  const notes = { connector: 'notes', scope: {}, includeAttachments: true };
  const books = { connector: 'books', scope: {}, includeAttachments: true };
  {
    using store = new Settings(scratch.path);
    store.select([notes, books], options);
    store.watch('notes');
    store.watch('books');
  }

  using store = new Settings(scratch.path);
  const reopened = store.watched();
  store.select([{ ...notes, scope: { accountIds: ['a'] } }, books], options);
  const narrowed = store.watched();
  store.unwatch('books');
  const switchedOff = store.watched();
  store.watch('books');
  store.select([books], options);
  store.watch('contacts');
  store.select(
    [
      notes,
      books,
      { connector: 'contacts', scope: {}, includeAttachments: true },
    ],
    options,
  );
  const reconnected = store.watched();

  assert.deepEqual(reopened, ['notes', 'books']);
  assert.deepEqual(narrowed, ['notes', 'books']);
  assert.deepEqual(switchedOff, ['notes']);
  assert.deepEqual(reconnected, ['books']);
});

test('removing a connector stops its running import', async () => {
  await using scratch = await new TemporaryFiles().directory('store-');
  const notes = { connector: 'notes', scope: {}, includeAttachments: true };
  using store = new Settings(scratch.path);
  store.select([notes], options);
  using removal = store.removal(notes, globalThis);
  const removed = Promise.withResolvers<unknown>();
  removal.signal.addEventListener(
    'abort',
    () => removed.resolve(removal.signal.reason),
    { once: true },
  );

  // Another setup removes Notes while its import runs.
  {
    using other = new Settings(scratch.path);
    other.select([], options);
  }
  const reason = await removed.promise;

  assert.ok(reason instanceof ConnectorRemovedError);
  assert.equal(reason.message, 'notes was removed from the selection');
});

test('a selection that keeps a connector never stops its import', async () => {
  await using scratch = await new TemporaryFiles().directory('store-');
  const notes = { connector: 'notes', scope: {}, includeAttachments: true };
  const books = { connector: 'books', scope: {}, includeAttachments: true };
  using store = new Settings(scratch.path);
  store.select([notes], options);
  using removal = store.removal(notes, globalThis);

  store.select([notes, books], options);
  await new Promise((resolve) => setTimeout(resolve, 1_500));

  assert.equal(removal.signal.aborted, false);
});

test('a selection that no longer names the import stops it before the first heartbeat', async () => {
  await using scratch = await new TemporaryFiles().directory('store-');
  const notes = { connector: 'notes', scope: {}, includeAttachments: true };
  using store = new Settings(scratch.path);
  store.select([], options);

  using removal = store.removal(notes, globalThis);

  assert.ok(removal.signal.reason instanceof ConnectorRemovedError);
});

test('a selection that cannot be read stops the import with its error and leaves the process running', async () => {
  await using scratch = await new TemporaryFiles().directory('store-');
  const notes = { connector: 'notes', scope: {}, includeAttachments: true };
  using store = new Settings(scratch.path);
  store.select([notes], options);
  using removal = store.removal(notes, globalThis);
  const stopped = Promise.withResolvers<unknown>();
  removal.signal.addEventListener(
    'abort',
    () => stopped.resolve(removal.signal.reason),
    { once: true },
  );

  // Only another program can take the table away; no operation of Settings does.
  {
    using other = open(join(scratch.path, 'settings.sqlite'));
    other.exec('DROP TABLE selections');
  }
  const reason = await stopped.promise;

  assert.ok(Error.isError(reason));
  assert.match(reason.message, /no such table: selections/);
});

test('a disposed removal checks no more', async () => {
  await using scratch = await new TemporaryFiles().directory('store-');
  const notes = { connector: 'notes', scope: {}, includeAttachments: true };
  using store = new Settings(scratch.path);
  store.select([notes], options);
  const removal = store.removal(notes, globalThis);

  removal[Symbol.dispose]();
  store.select([], options);
  await new Promise((resolve) => setTimeout(resolve, 1_500));

  assert.equal(removal.signal.aborted, false);
});

test('the transcription choice persists independently of connector selections and can be turned off', async () => {
  await using directory = await new TemporaryFiles().directory(
    'transcription-settings-',
  );
  {
    using settings = new Settings(directory.path);
    assert.equal(settings.transcription(), null);
    settings.select(
      [{ connector: 'notes', scope: {}, includeAttachments: true }],
      options,
    );
    settings.setTranscription('cohere-transcribe-arabic-07-2026-Q8_0.gguf');
  }
  {
    using settings = new Settings(directory.path);
    assert.equal(
      settings.transcription(),
      'cohere-transcribe-arabic-07-2026-Q8_0.gguf',
    );
    assert.equal(settings.selections()[0]?.connector, 'notes');
    settings.setTranscription(null);
  }
  using settings = new Settings(directory.path);
  assert.equal(settings.transcription(), null);
  assert.equal(settings.selections()[0]?.connector, 'notes');
});
