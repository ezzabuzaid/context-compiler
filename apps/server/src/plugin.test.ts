import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { chmod, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { TemporaryFiles } from '@zukhruf/fs';
import {
  PersistentWriteAheadLog,
  RollbackJournal,
  open,
} from '@zukhruf/sqlite-open';
import { waitFor } from '@zukhruf/testing/async';
import { z } from 'zod';

import type { FailureType } from '@eltjs/elt';
import { SQLiteSyncHistory } from '@eltjs/elt-sqlite';
import { StubEventKitHelper } from '@eltjs/sdk-apple-eventkit/test';
import { MacOSDocumentParser } from '@eltjs/source-apple-macos/macos-document-parser';
import { builtInConnectors } from '@workspace/connector-manifest/built-in-connectors';
import { Connectors } from '@workspace/connector-manifest/connectors';
import { type Selection, importDirectory } from '@workspace/settings';
import { connectorsResult } from '@workspace/ui/contract';

import { chatStatus } from './chat-status.ts';
import {
  connectorChoices,
  connectorRows,
  updateConnector,
} from './connector-page.ts';
import { Plugin } from './plugin.ts';

// The workspace root: the tests read its fixtures and builds from any
// working directory.
const workspace = resolve(import.meta.dirname, '../../..');

// The committed plugin, as Codex installs it.
const versionFile = resolve(
  workspace,
  'plugins/context-compiler/server/version.json',
);
const pageUri = 'codex://plugins/context-compiler/app/page';

// The host the plugin's server passes its connectors, with the helper this
// workspace compiled instead of the bundled copy.
const host = {
  clock: globalThis,
  home: homedir(),
  env: process.env,
  grantee: 'ChatGPT',
  documentParser: new MacOSDocumentParser(),
  eventKitHelper: fileURLToPath(
    import.meta.resolve('@eltjs/sdk-apple-eventkit/eventkit-helper'),
  ),
};

// The plugin as its server creates it, over the built-in connectors.
async function createPlugin(
  versionFile: string,
  directory: string,
  pluginHost = host,
) {
  const plugin = new Plugin(
    new Connectors([builtInConnectors]),
    pluginHost,
    versionFile,
    directory,
  );
  await plugin.refresh();
  return plugin;
}

// The EventKit helper with this Mac's calendars: one account holding one
// calendar. Listing calendars needs full Calendar access, which a CI runner
// has no grant for, so a stub stands in for the compiled helper.
async function oneCalendar() {
  const stub = await StubEventKitHelper.create();
  stub.answer(
    { entity: 'events', collectionsOnly: true },
    {
      documents: [
        {
          type: 'account',
          id: 'account-1',
          name: 'Default',
          sourceType: 0,
          isDelegate: false,
        },
        {
          type: 'calendar',
          id: 'calendar-1',
          accountId: 'account-1',
          name: 'Synthetic calendar',
          calendarType: 0,
          writable: true,
          subscribed: false,
          immutable: false,
          color: [
            0.7960784435272217, 0.1882352977991104, 0.8784313797950745, 1,
          ],
          supportedAvailabilities: 0,
          allowedEntityTypes: 1,
          notes: 'Synthetic calendar for recorded EventKit test data',
          selected: true,
        },
      ],
    },
  );
  return stub;
}

// The plugin over the built-in connectors and the fixture Photos connector,
// whose pass reads $HOME/Pictures/photos.json.
async function photosPlugin(directory: string, home: string) {
  const plugin = new Plugin(
    new Connectors([
      builtInConnectors,
      resolve(workspace, 'packages/connectors/manifest/src/fixtures'),
    ]),
    { ...host, home },
    versionFile,
    directory,
  );
  await plugin.refresh();
  return plugin;
}

// Stands in for a server's import of one connector selection.
function imported(directory: string, item: Selection) {
  const path = importDirectory(directory, item);
  mkdirSync(path, { recursive: true });
  using database = open(join(path, 'data.sqlite'), {
    journal: new RollbackJournal(),
  });
  database.exec("CREATE TABLE notes(id TEXT); INSERT INTO notes VALUES('n1');");
  return join(path, 'data.sqlite');
}

// Begins passes of one connector selection's import, recorded in its
// data.sqlite as a server's history records them: each pass declares every
// copy of the connection, and one that finishes loads them all.
async function passes(plugin: Plugin, item: Selection) {
  const {
    connections: [connection],
  } = await plugin
    .connector(item.connector)
    .connections(importDirectory(plugin.directory, item), item);
  // A server's pipeline installs its history before a pass; these passes
  // begin without one.
  const history = new SQLiteSyncHistory();
  await history.install([connection], new Date());
  const copies = connection.steps.map((copy) => ({
    copy,
    coverage: connection.source.coverage(copy.from),
  }));
  return async () => {
    const pass = await history.begin(connection, copies, new Date());
    const end = (cancelled: boolean) =>
      pass.finish(
        copies.map(({ copy }) => ({
          copy,
          count: 0,
          deleted: 0,
          failures: [],
          cancelled,
        })),
        // Every Notes stream reads a live upstream here.
        new Map(),
        new Date(),
      );
    return {
      finish: () => end(false),
      cancel: () => end(true),
      fail: (error: unknown, failureType: FailureType) =>
        pass.fail(error, failureType, new Date()),
    };
  };
}

test('Setup rejects invalid choices and keeps a Calendar scope as given, so each import reads the default window when it runs', async () => {
  await using scratch = await new TemporaryFiles().directory('plugin-');
  const plugin = await createPlugin(versionFile, scratch.path);
  assert.deepEqual(plugin.status().connectors, []);
  for (const [selection, message] of [
    [
      [
        {
          connector: 'contacts',
          scope: { startAt: '2025-01-01T00:00:00.000Z' },
          includeAttachments: true,
        },
      ],
      /date filtering/,
    ],
    [
      [
        {
          connector: 'messages',
          scope: { accountIds: ['a'] },
          includeAttachments: true,
        },
      ],
      /account IDs/,
    ],
    [
      [
        {
          connector: 'notes',
          scope: { collectionIds: [] },
          includeAttachments: true,
        },
      ],
      /at least one collection/,
    ],
    [
      [
        { connector: 'notes', scope: {}, includeAttachments: true },
        { connector: 'notes', scope: {}, includeAttachments: true },
      ],
      /once/,
    ],
  ] as const)
    await assert.rejects(
      () => plugin.configure({ connectors: selection }),
      message,
    );
  assert.deepEqual(plugin.status().connectors, []);
  const since = { startAt: '2025-01-01T00:00:00.000Z' };
  const [calendar] = await plugin.configure({
    connectors: [
      { connector: 'calendar', scope: {}, includeAttachments: true },
    ],
  });
  assert.deepEqual(calendar?.scope, {});
  const [started] = await plugin.configure({
    connectors: [
      { connector: 'calendar', scope: since, includeAttachments: true },
    ],
  });
  assert.deepEqual(started?.scope, since);

  // An import reads its window when it runs: two built a moment apart end a
  // moment apart, each a year after it runs.
  const windows = async () => {
    const {
      connections: [connection],
    } = await plugin
      .connector('calendar')
      .connections(importDirectory(plugin.directory, calendar), calendar);
    return connection.steps
      .map((copy) => connection.source.coverage(copy.from).selection)
      .filter((selection) => 'endAt' in selection);
  };
  const yearAhead = new Date();
  yearAhead.setUTCFullYear(yearAhead.getUTCFullYear() + 1);
  const [first] = await windows();
  await sleep(5);
  const [later] = await windows();
  assert.ok(first && later);
  assert.equal(first.startAt, '2000-01-01T00:00:00.000Z');
  assert.ok(Date.parse(String(first.endAt)) >= yearAhead.getTime());
  assert.ok(Date.parse(String(later.endAt)) > Date.parse(String(first.endAt)));
});

test('agents read the selected connectors, where each import lives and what macOS access it needs from the settings file with the sqlite3 shell', async () => {
  await using scratch = await new TemporaryFiles().directory('plugin-');
  const plugin = await createPlugin(versionFile, scratch.path);
  const notes = {
    connector: 'notes' as const,
    scope: { collectionIds: ['folder-1'] },
    includeAttachments: false,
  };
  await plugin.configure({
    connectors: [
      notes,
      { connector: 'mail', scope: {}, includeAttachments: true },
    ],
  });
  const { stdout, stderr } = spawnSync(
    '/usr/bin/sqlite3',
    [
      '-readonly',
      '-json',
      join(scratch.path, 'settings.sqlite'),
      'SELECT connector, scope, include_attachments, database, connection_error FROM selected_connectors',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(stderr, '');
  assert.deepEqual(JSON.parse(stdout), [
    {
      connector: 'notes',
      scope: JSON.stringify(notes.scope),
      include_attachments: 0,
      database: relative(
        scratch.path,
        join(importDirectory(scratch.path, notes), 'data.sqlite'),
      ),
      connection_error: null,
    },
    {
      connector: 'mail',
      scope: '{}',
      include_attachments: 1,
      database: relative(
        scratch.path,
        join(
          importDirectory(scratch.path, {
            connector: 'mail',
            scope: {},
            includeAttachments: true,
          }),
          'data.sqlite',
        ),
      ),
      connection_error: null,
    },
  ]);
});

test('Setup imports only what a change adds or changes, keeps an unchanged import and removes a changed or disconnected one', async () => {
  await using scratch = await new TemporaryFiles().directory('plugin-');
  const plugin = await createPlugin(versionFile, scratch.path);
  const notes = {
    connector: 'notes' as const,
    scope: { collectionIds: ['folder-1'] },
    includeAttachments: true,
  };
  assert.deepEqual(await plugin.configure({ connectors: [notes] }), [notes]);
  assert.equal(plugin.status().connectors[0]?.database, null);
  const database = imported(scratch.path, notes);
  assert.equal(
    (await createPlugin(versionFile, scratch.path)).status().connectors[0]
      ?.database,
    database,
  );
  const books = { connector: 'books', scope: {}, includeAttachments: true };
  assert.deepEqual(await plugin.configure({ connectors: [notes, books] }), [
    books,
  ]);
  assert.equal(existsSync(database), true);

  const changed = { ...notes, scope: { collectionIds: ['folder-2'] } };
  assert.deepEqual(await plugin.configure({ connectors: [changed] }), [
    changed,
  ]);
  assert.equal(existsSync(database), false);
  const [current] = plugin.status().connectors;
  assert.equal(current?.database, null);
  assert.equal(current?.sync, null);
  imported(scratch.path, changed);
  assert.deepEqual(await plugin.configure({ connectors: [] }), []);
  assert.deepEqual(readdirSync(join(scratch.path, 'notes')), []);
});

test('saving Calendar again without dates keeps its import', async () => {
  await using scratch = await new TemporaryFiles().directory('plugin-');
  const plugin = await createPlugin(versionFile, scratch.path);
  const calendar = {
    connector: 'calendar' as const,
    scope: {},
    includeAttachments: true,
  };
  const [first] = await plugin.configure({ connectors: [calendar] });
  assert.ok(first);
  const database = imported(scratch.path, first);
  // Saves happen at different moments.
  await sleep(5);

  assert.deepEqual(await plugin.configure({ connectors: [calendar] }), []);
  assert.equal(existsSync(database), true);
});

test('Calendar options give an agent no dates to copy, and name the default window', async () => {
  await using scratch = await new TemporaryFiles().directory('plugin-');
  await using calendars = await oneCalendar();
  const plugin = await createPlugin(versionFile, scratch.path, {
    ...host,
    eventKitHelper: calendars.path,
  });

  const { choices: _choices, ...options } = await plugin.options('calendar');

  // Choices are this Mac's calendars, whose names may hold any text.
  assert.doesNotMatch(JSON.stringify(options), /\d{4}-\d\d-\d\dT\d\d:\d\d/);
  assert.match(String(options.datedBy), /2000/);
});

test('connecting Calendar on the page saves a scope without dates, so saving it again keeps its import', async () => {
  await using scratch = await new TemporaryFiles().directory('plugin-');
  await using calendars = await oneCalendar();
  const plugin = await createPlugin(versionFile, scratch.path, {
    ...host,
    eventKitHelper: calendars.path,
  });
  const choices = await connectorChoices(plugin, 'calendar');

  const connected = await updateConnector(
    plugin,
    'calendar',
    choices.defaultSelection,
  );
  // Saves happen at different moments.
  await sleep(5);
  const again = await updateConnector(
    plugin,
    'calendar',
    choices.defaultSelection,
  );

  assert.equal(connected.newImports.length, 1);
  assert.deepEqual(
    connected.connectors.find(({ name }) => name === 'calendar')?.selection
      ?.scope,
    {},
  );
  assert.deepEqual(again.newImports, []);
  assert.match(String(choices.datedBy), /2000/);
});

test('importing settles when the settings cannot be read, so the server keeps serving its tools', async () => {
  await using scratch = await new TemporaryFiles().directory('plugin-');
  // A directory where the settings file belongs fails every read of them.
  mkdirSync(join(scratch.path, 'settings.sqlite'));
  const plugin = await createPlugin(versionFile, scratch.path);

  await assert.doesNotReject(
    plugin.import([
      { connector: 'notes', scope: {}, includeAttachments: true },
    ]),
  );
});

test('an import that fails before its pass begins shows the failure on the page and in chat, not that it waits to import', async () => {
  await using scratch = await new TemporaryFiles().directory('plugin-');
  const plugin = await photosPlugin(
    join(scratch.path, 'store'),
    join(scratch.path, 'home'),
  );
  const photos = { connector: 'photos', scope: {}, includeAttachments: true };
  const imports = await plugin.configure({ connectors: [photos] });
  // A database the import cannot write stands in for one a reader keeps
  // busy past the timeout, or a full disk: the import's sync history cannot
  // install itself, so no pass begins to record why.
  const directory = importDirectory(plugin.directory, photos);
  mkdirSync(directory, { recursive: true });
  await writeFile(join(directory, 'data.sqlite'), '');
  await chmod(join(directory, 'data.sqlite'), 0o444);

  await plugin.import(imports);

  const row = connectorRows(plugin).find(({ name }) => name === 'photos');
  assert.equal(row?.status.state, 'failed');
  assert.equal(
    row?.status.text,
    'Last sync failed: attempt to write a readonly database',
  );
  assert.match(
    chatStatus(plugin, pageUri).text,
    /^- Photos: last sync failed at .*: attempt to write a readonly database/m,
  );
});

test('an import that synced before and now fails before its pass begins shows the failure, not its last sync', async () => {
  await using scratch = await new TemporaryFiles().directory('plugin-');
  const home = join(scratch.path, 'home');
  mkdirSync(join(home, 'Pictures'), { recursive: true });
  await writeFile(
    join(home, 'Pictures/photos.json'),
    JSON.stringify([{ id: 'p1', title: 'Beach' }]),
  );
  const plugin = await photosPlugin(join(scratch.path, 'store'), home);
  const photos = { connector: 'photos', scope: {}, includeAttachments: true };
  const imports = await plugin.configure({ connectors: [photos] });
  const statusOf = () =>
    connectorRows(plugin).find(({ name }) => name === 'photos')?.status;
  await plugin.import(imports);
  const synced = statusOf();
  // The import can no longer write its database, as when a reader keeps it
  // busy past the timeout or the disk is full.
  await chmod(
    join(importDirectory(plugin.directory, photos), 'data.sqlite'),
    0o444,
  );

  await plugin.import(imports);

  assert.equal(synced?.state, 'succeeded');
  assert.equal(statusOf()?.state, 'failed');
  assert.equal(
    statusOf()?.text,
    'Last sync failed: attempt to write a readonly database',
  );
});

test('once an import that failed before its pass can write again, its next pass syncs and the failure is gone', async () => {
  await using scratch = await new TemporaryFiles().directory('plugin-');
  const home = join(scratch.path, 'home');
  mkdirSync(join(home, 'Pictures'), { recursive: true });
  await writeFile(
    join(home, 'Pictures/photos.json'),
    JSON.stringify([{ id: 'p1', title: 'Beach' }]),
  );
  const plugin = await photosPlugin(join(scratch.path, 'store'), home);
  const photos = { connector: 'photos', scope: {}, includeAttachments: true };
  const imports = await plugin.configure({ connectors: [photos] });
  const directory = importDirectory(plugin.directory, photos);
  const database = join(directory, 'data.sqlite');
  mkdirSync(directory, { recursive: true });
  await writeFile(database, '');
  await chmod(database, 0o444);
  await plugin.import(imports);
  const failed = connectorRows(plugin).find(
    ({ name }) => name === 'photos',
  )?.status;
  await chmod(database, 0o644);

  await plugin.import(imports);

  const row = connectorRows(plugin).find(({ name }) => name === 'photos');
  assert.equal(failed?.state, 'failed');
  assert.equal(row?.status.state, 'succeeded');
  assert.match(String(row?.status.text), /^Synced just now/);
  assert.doesNotMatch(chatStatus(plugin, pageUri).text, /last sync failed/);
});

test('a pass a killed process left days ago reads importing with the day it began and how long ago, not as if it began today', async (t) => {
  await using scratch = await new TemporaryFiles().directory('plugin-');
  const plugin = await photosPlugin(
    join(scratch.path, 'store'),
    join(scratch.path, 'home'),
  );
  const photos = { connector: 'photos', scope: {}, includeAttachments: true };
  await plugin.configure({ connectors: [photos] });
  // A pass begun and never finished, as a process killed mid-pass leaves it.
  await (
    await passes(plugin, photos)
  )();
  const started = new Date(
    String(plugin.status().connectors[0]?.sync?.startedAt),
  );
  const day = (date: Date) =>
    date.toLocaleString('en', { month: 'short', day: 'numeric' });
  const time = (date: Date) =>
    date.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
  // The history stamps a pass with SQLite's clock; the page reads it on
  // JavaScript's, three days and five hours on.
  const later = new Date(started.getTime() + (3 * 24 + 5) * 3_600_000);
  t.mock.timers.enable({ apis: ['Date'], now: later });
  try {
    const text = connectorRows(plugin).find(({ name }) => name === 'photos')
      ?.status.text;

    assert.equal(
      text,
      `Importing since ${day(started)}, ${time(started)} (3 days ago).`,
    );
    assert.notEqual(
      `${day(started)} ${time(started)}`,
      `${day(later)} ${time(later)}`,
    );
  } finally {
    t.mock.timers.reset();
  }
});

test('the next import replaces a pass a killed process left, so syncing a connector that reads importing is never stuck', async () => {
  await using scratch = await new TemporaryFiles().directory('plugin-');
  const home = join(scratch.path, 'home');
  mkdirSync(join(home, 'Pictures'), { recursive: true });
  await writeFile(
    join(home, 'Pictures/photos.json'),
    JSON.stringify([{ id: 'p1', title: 'Beach' }]),
  );
  const plugin = await photosPlugin(join(scratch.path, 'store'), home);
  const photos = { connector: 'photos', scope: {}, includeAttachments: true };
  await plugin.configure({ connectors: [photos] });
  const statusOf = () =>
    connectorRows(plugin).find(({ name }) => name === 'photos')?.status;
  // A pass begun and never finished, as a process killed mid-pass leaves it:
  // its flight died with that process, and here no flight was ever held.
  await (
    await passes(plugin, photos)
  )();
  const left = statusOf();
  // As the row's Sync calls it: the selection read back from status.
  await plugin.import(
    plugin
      .status()
      .connectors.filter(({ connector }) => connector === 'photos'),
  );

  assert.equal(left?.state, 'running');
  assert.equal(statusOf()?.state, 'succeeded');
  assert.match(String(statusOf()?.text), /^Synced just now/);
});

test('two servers importing one selection at once load it in one pass, the second waiting for the first', async (t) => {
  await using scratch = await new TemporaryFiles().directory('plugin-');
  // A pipe the test writes once the pass runs: the Photos read waits on it,
  // so the second import asks while the first one's pass still runs.
  const home = join(scratch.path, 'home');
  mkdirSync(join(home, 'Pictures'), { recursive: true });
  spawnSync('/usr/bin/mkfifo', [join(home, 'Pictures/photos.json')]);
  const plugin = await photosPlugin(join(scratch.path, 'store'), home);
  const photos = { connector: 'photos', scope: {}, includeAttachments: true };
  const imports = await plugin.configure({ connectors: [photos] });
  const both = Promise.all([plugin.import(imports), plugin.import(imports)]);
  await waitFor(
    () =>
      assert.equal(
        plugin.status().connectors[0]?.sync?.state,
        'running',
        'no import started its pass',
      ),
    { signal: t.signal, interval: 50 },
  );

  await writeFile(
    join(home, 'Pictures/photos.json'),
    JSON.stringify([{ id: 'p1', title: 'Beach' }]),
  );
  await both;

  using data = open(
    join(importDirectory(plugin.directory, photos), 'data.sqlite'),
    { readOnly: true },
  );
  assert.deepEqual(
    data
      .prepare('SELECT status FROM sync_attempts')
      .all()
      .map((row) => ({ ...row })),
    [{ status: 'succeeded' }],
  );
});

test('a connector switched off while its pass runs loses its import once the pass ends', async (t) => {
  await using scratch = await new TemporaryFiles().directory('plugin-');
  // A pipe the test writes once the connector is switched off: the Photos
  // read waits on it, so the pass is still running when the switch happens.
  const home = join(scratch.path, 'home');
  mkdirSync(join(home, 'Pictures'), { recursive: true });
  spawnSync('/usr/bin/mkfifo', [join(home, 'Pictures/photos.json')]);
  const plugin = await photosPlugin(join(scratch.path, 'store'), home);
  const photos = { connector: 'photos', scope: {}, includeAttachments: true };
  const imports = await plugin.configure({ connectors: [photos] });
  const directory = importDirectory(plugin.directory, photos);
  const importing = plugin.import(imports);
  await waitFor(
    () =>
      assert.equal(
        plugin.status().connectors[0]?.sync?.state,
        'running',
        'no import started its pass',
      ),
    { signal: t.signal, interval: 50 },
  );

  await plugin.configure({ connectors: [] });
  const keptWhileRunning = existsSync(directory);
  await writeFile(
    join(home, 'Pictures/photos.json'),
    JSON.stringify([{ id: 'p1', title: 'Beach' }]),
  );
  await importing;

  assert.equal(keptWhileRunning, true);
  assert.equal(existsSync(directory), false);
});

test('a chat hears of a pass only when it changes what a reader can do with the connector', async () => {
  await using scratch = await new TemporaryFiles().directory('plugin-');
  const plugin = await createPlugin(versionFile, scratch.path);
  const notes = {
    connector: 'notes' as const,
    scope: {},
    includeAttachments: true,
  };
  await plugin.configure({ connectors: [notes] });
  const waiting = chatStatus(plugin, pageUri);
  assert.match(
    waiting.text,
    /^- Notes: waiting for its first import\. No database yet\.$/m,
  );
  const begin = await passes(plugin, notes);
  await begin();
  const importing = chatStatus(plugin, pageUri);
  assert.match(
    importing.text,
    /^- Notes: importing since .*; not every stream has loaded completely yet; stream_status has each stream's current_as_of\. Database: notes\//m,
  );
  assert.notEqual(importing.state, waiting.state);
  await (await begin()).finish();
  const synced = chatStatus(plugin, pageUri);
  assert.match(synced.text, /^- Notes: synced at /m);
  assert.notEqual(synced.state, importing.state);

  // Passes over data already imported change its times, not the state.
  const again = await begin();
  assert.equal(chatStatus(plugin, pageUri).state, synced.state);
  await again.finish();
  assert.equal(chatStatus(plugin, pageUri).state, synced.state);

  await (await begin()).fail(new Error('Notes could not be opened.'), 'config');
  const failed = chatStatus(plugin, pageUri);
  await (await begin()).fail(new Error('Notes crashed.'), 'system');
  const crashed = chatStatus(plugin, pageUri);
  assert.ok(
    failed.text.includes(': Notes could not be opened.; data as of '),
    failed.text,
  );
  assert.notEqual(failed.state, synced.state);
  assert.match(
    crashed.text,
    /^- Notes: last sync failed at .*: Notes crashed\.; data as of /m,
  );
});

test('a chat never calls an import empty while it holds rows that a pass loaded before a stream failed', async () => {
  await using scratch = await new TemporaryFiles().directory('plugin-');
  const home = join(scratch.path, 'home');
  mkdirSync(join(home, 'Pictures'), { recursive: true });
  // The second entry fails the stream after the first photo committed.
  await writeFile(
    join(home, 'Pictures/photos.json'),
    JSON.stringify([{ id: 'p1', title: 'Beach' }, 'not a photo']),
  );
  const plugin = await photosPlugin(join(scratch.path, 'store'), home);
  const photos = { connector: 'photos', scope: {}, includeAttachments: true };
  const imports = await plugin.configure({ connectors: [photos] });
  await plugin.import(imports);
  const partial = chatStatus(plugin, pageUri).text;
  const begin = await passes(plugin, photos);
  await begin();
  const running = chatStatus(plugin, pageUri).text;
  await (await begin()).fail(new Error('Photos crashed.'), 'system');
  const failed = chatStatus(plugin, pageUri).text;
  await (await begin()).cancel();
  const cancelled = chatStatus(plugin, pageUri).text;

  using data = open(
    join(importDirectory(plugin.directory, photos), 'data.sqlite'),
    { readOnly: true },
  );
  assert.deepEqual(
    data
      .prepare('SELECT id FROM photos')
      .all()
      .map(({ id }) => id),
    ['p1'],
  );
  // Where the chat sends the reader: the stream is listed, not current.
  assert.deepEqual(
    data
      .prepare('SELECT stream, current_as_of FROM stream_status')
      .all()
      .map((row) => ({ ...row })),
    [{ stream: 'photos', current_as_of: null }],
  );
  assert.match(
    partial,
    /^- Photos: partly synced at .*; not every stream has loaded completely yet; stream_status has each stream's current_as_of\. Database: photos\//m,
  );
  assert.match(
    running,
    /^- Photos: importing since .*; not every stream has loaded completely yet; stream_status has each stream's current_as_of\. Database: photos\//m,
  );
  assert.match(
    failed,
    /^- Photos: last sync failed at .*: Photos crashed\.; not every stream has loaded completely yet; stream_status has each stream's current_as_of\. Database: photos\//m,
  );
  assert.match(
    cancelled,
    /^- Photos: its last pass was stopped before it finished; not every stream has loaded completely yet; stream_status has each stream's current_as_of\. Database: photos\//m,
  );
  for (const text of [partial, running, failed, cancelled])
    assert.doesNotMatch(text, /no data yet/);
});

test('the Context Compiler page and chat report Mail local freshness and content gaps, including a newly downloaded body', async () => {
  await using scratch = await new TemporaryFiles().directory('mail-status-');
  const plugin = await createPlugin(versionFile, scratch.path);
  const mail = { connector: 'mail', scope: {}, includeAttachments: false };
  await plugin.configure({ connectors: [mail] });
  const begin = await passes(plugin, mail);
  await (await begin()).finish();
  const beforeContent = chatStatus(plugin, pageUri);
  assert.match(beforeContent.text, /Content availability is not known/);
  // The Mail connector's own import test checks this view against the real
  // Mail source. Here the reader boundary lets the page see a newly arriving
  // body without opening the user's real Mail store.
  const path = plugin.status().connectors[0]?.database;
  assert.ok(path);
  using database = open(path, { journal: new PersistentWriteAheadLog() });
  database.exec(`CREATE TABLE counts (
    message_count INTEGER, latest_received_at TEXT,
    missing_message_files INTEGER, missing_text_bodies INTEGER,
    attachment_count INTEGER, unavailable_attachments INTEGER
  );
  INSERT INTO counts VALUES (4, '2026-10-12T10:50:34.000Z', 1, 2, 3, 1);
  CREATE VIEW mail_content_status AS SELECT * FROM counts;`);
  const rows = connectorRows(plugin);
  z.object(connectorsResult).parse({ connectors: rows });
  const details = rows
    .find(({ name }) => name === 'mail')
    ?.status.details.join('\n');
  assert.match(String(details), /Imported source data as of /);
  assert.match(
    String(details),
    /Newest locally received message: 2026-10-12T10:50:34.000Z/,
  );
  assert.match(
    String(details),
    /1 without a downloaded message file; 2 without readable body text/,
  );
  assert.match(String(details), /3 attachments: 1 unavailable/);
  assert.match(String(details), /Cloud inbox freshness is unknown/);
  const missing = chatStatus(plugin, pageUri);
  assert.notEqual(missing.state, beforeContent.state);
  assert.match(missing.text, /Newest locally received message: 2026-10-12/);
  assert.match(missing.text, /without readable body text/);
  database.exec(
    "UPDATE counts SET latest_received_at = '2026-10-13T14:50:33.000Z', missing_message_files = 0, missing_text_bodies = 1",
  );
  const downloaded = chatStatus(plugin, pageUri);
  assert.notEqual(downloaded.state, missing.state);
  assert.match(downloaded.text, /Newest locally received message: 2026-10-13/);
  assert.match(
    downloaded.text,
    /0 without a downloaded message file; 1 without readable body text/,
  );
  await (await begin()).fail(new Error('Mail kept changing.'), 'system');
  const partial = chatStatus(plugin, pageUri);
  assert.match(partial.text, /Mail kept changing.*data as of/);
  assert.match(partial.text, /Newest locally received message/);
});

test('a selected connector that is no longer loaded is reported, keeps its import through other changes, and can be disconnected', async () => {
  await using scratch = await new TemporaryFiles().directory('plugin-');
  const withPhotos = await photosPlugin(
    scratch.path,
    join(scratch.path, 'home'),
  );
  const photos = { connector: 'photos', scope: {}, includeAttachments: true };
  await withPhotos.configure({ connectors: [photos] });
  const plugin = await createPlugin(versionFile, scratch.path);

  const [reported] = plugin.status().connectors;
  const context = chatStatus(plugin, pageUri).text;
  const imports = await plugin.configure({
    connectors: [
      photos,
      { connector: 'notes', scope: {}, includeAttachments: true },
    ],
  });
  const kept = plugin.status().connectors;
  const changed = () =>
    plugin.configure({
      connectors: [{ ...photos, includeAttachments: false }],
    });
  const listed = connectorRows(plugin).find(({ name }) => name === 'photos');
  const { connectors: rows } = await updateConnector(plugin, 'photos', null);

  assert.equal(reported?.title, 'photos');
  assert.match(
    String(reported?.permissions),
    /No connector named photos is loaded/,
  );
  assert.match(context, /^- photos: No connector named photos is loaded/m);
  assert.deepEqual(
    kept.map(({ connector }) => connector),
    ['photos', 'notes'],
  );
  assert.deepEqual(
    imports.map(({ connector }) => connector),
    ['notes'],
  );
  await assert.rejects(
    changed,
    /No connector named photos is loaded, so its selection cannot change/,
  );
  assert.deepEqual(
    {
      title: listed?.title,
      loaded: listed?.loaded,
      selected: listed?.selection !== null,
    },
    { title: 'photos', loaded: false, selected: true },
  );
  assert.match(
    String(listed?.status.text),
    /No connector named photos is loaded/,
  );
  assert.equal(
    rows.some(({ name }) => name === 'photos'),
    false,
  );
  assert.deepEqual(
    plugin.status().connectors.map(({ connector }) => connector),
    ['notes'],
  );
});

test('the sidebar page describes each connector’s import and switches one connector without touching the others or moving its row', async () => {
  await using scratch = await new TemporaryFiles().directory('plugin-');
  const plugin = await createPlugin(versionFile, scratch.path);
  const statusOf = (name: string) =>
    connectorRows(plugin).find((row) => row.name === name)?.status;
  const described = (name: string) => statusOf(name)?.text;
  const order = connectorRows(plugin).map(({ name }) => name);
  assert.equal(described('notes'), 'Not connected.');

  const notes = {
    connector: 'notes' as const,
    scope: { collectionIds: ['FOLDER-NOTES'] },
    includeAttachments: true,
  };
  await updateConnector(plugin, 'notes', {
    scope: notes.scope,
    includeAttachments: true,
  });
  assert.equal(described('notes'), 'Waiting to import.');
  const begin = await passes(plugin, notes);
  await (await begin()).finish();
  assert.equal(described('notes'), 'Synced just now · 1 folder.');
  // The page shows the error as it is, and offers to open Full Disk Access,
  // since granting it is the fix.
  await (await begin()).fail(new Error('Notes could not be opened.'), 'config');
  assert.partialDeepStrictEqual(statusOf('notes'), {
    state: 'failed',
    text: 'Last sync failed: Notes could not be opened.',
    fullDiskAccess: true,
  });
  // A failure granting access cannot fix shows only what went wrong.
  await (await begin()).fail(new Error('Notes crashed.'), 'system');
  assert.partialDeepStrictEqual(statusOf('notes'), {
    state: 'failed',
    text: 'Last sync failed: Notes crashed.',
    fullDiskAccess: false,
  });
  await begin();
  assert.match(String(described('notes')), /^Importing since /);
  // Contacts needs no Full Disk Access, so its access failure does not offer
  // to open it.
  const contacts = {
    connector: 'contacts' as const,
    scope: {},
    includeAttachments: true,
  };
  await updateConnector(plugin, 'contacts', {
    scope: {},
    includeAttachments: true,
  });
  await (
    await (
      await passes(plugin, contacts)
    )()
  ).fail(new Error('Contacts could not be opened.'), 'config');
  assert.partialDeepStrictEqual(statusOf('contacts'), {
    state: 'failed',
    text: 'Last sync failed: Contacts could not be opened.',
    fullDiskAccess: false,
  });
  await updateConnector(plugin, 'contacts', null);

  // Switching Mail on keeps Notes as it was chosen; switching Notes off
  // disconnects it and removes its import. No row moves.
  imported(scratch.path, notes);
  const { connectors: rows } = await updateConnector(plugin, 'mail', {
    scope: {},
    includeAttachments: true,
  });
  assert.deepEqual(
    Object.fromEntries(
      rows.map(({ name, selection }) => [name, selection !== null]),
    ),
    {
      mail: true,
      notes: true,
      messages: false,
      contacts: false,
      instagram: false,
      opensooq: false,
      calendar: false,
      reminders: false,
      safari: false,
      dia: false,
      chrome: false,
      arc: false,
      edge: false,
      books: false,
      activity: false,
      accounts: false,
      'call-history': false,
      clock: false,
      'notification-center': false,
      slack: false,
      teams: false,
      wallet: false,
      whatsapp: false,
    },
  );
  assert.deepEqual(
    rows.map(({ name }) => name),
    order,
  );
  const [kept, mail] = plugin.status().connectors;
  assert.deepEqual(kept?.scope, notes.scope);
  assert.deepEqual(mail?.scope, {});
  assert.equal(mail?.includeAttachments, true);
  assert.equal(described('mail'), 'Waiting to import.');
  await updateConnector(plugin, 'notes', null);
  assert.deepEqual(
    plugin.status().connectors.map(({ connector }) => connector),
    ['mail'],
  );
  assert.deepEqual(readdirSync(join(scratch.path, 'notes')), []);
});

test('the sidebar page narrows a connector by date, says which connectors it can date, and widens a narrowed one back to everything', async () => {
  await using scratch = await new TemporaryFiles().directory('plugin-');
  const plugin = await createPlugin(versionFile, scratch.path);
  const dates = {
    startAt: '2026-01-01T00:00:00.000Z',
    endAt: '2026-02-01T00:00:00.000Z',
  };

  await updateConnector(plugin, 'calendar', {
    scope: dates,
    includeAttachments: true,
  });
  await updateConnector(plugin, 'notes', {
    scope: { collectionIds: ['FOLDER-NOTES'] },
    includeAttachments: false,
  });
  const { connectors: rows } = await updateConnector(plugin, 'notes', {
    scope: {},
    includeAttachments: true,
  });

  const row = (name: string) => rows.find((item) => item.name === name);
  assert.deepEqual(row('calendar')?.selection, {
    scope: dates,
    includeAttachments: true,
  });
  assert.equal(typeof row('calendar')?.datedBy, 'string');
  assert.equal(row('contacts')?.datedBy, null);
  assert.deepEqual(row('notes')?.selection, {
    scope: {},
    includeAttachments: true,
  });
  assert.deepEqual(
    plugin.status().connectors.map(({ connector, scope }) => ({
      connector,
      scope,
    })),
    [
      { connector: 'calendar', scope: dates },
      { connector: 'notes', scope: {} },
    ],
  );
});

test('once another plugin version replaces this one, its server refuses to change connectors and imports nothing', async () => {
  await using scratch = await new TemporaryFiles().directory('plugin-');
  // Installing another version deletes this version's folder.
  const replaced = join(scratch.path, 'install');
  mkdirSync(replaced);
  const sentinel = join(replaced, 'version.json');
  cpSync(versionFile, sentinel);
  const store = join(scratch.path, 'store');
  const plugin = await createPlugin(sentinel, store);
  const notes = { connector: 'notes', scope: {}, includeAttachments: true };
  await plugin.configure({ connectors: [notes] });
  // An import the newer version's selection no longer names.
  const unselected = imported(store, { ...notes, includeAttachments: false });
  assert.equal(plugin.updated(), false);
  rmSync(sentinel);
  assert.equal(plugin.updated(), true);
  await assert.rejects(
    () =>
      plugin.configure({
        connectors: [
          { connector: 'mail', scope: {}, includeAttachments: true },
        ],
      }),
    /open a new chat/i,
  );
  await assert.rejects(
    () =>
      updateConnector(plugin, 'mail', { scope: {}, includeAttachments: true }),
    /open a new chat/i,
  );

  await plugin.import([notes]);

  // Old code neither removes imports nor starts one.
  assert.equal(existsSync(unselected), true);
  assert.equal(existsSync(importDirectory(store, notes)), false);
});
