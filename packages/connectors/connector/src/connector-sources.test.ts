import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { open } from '@zukhruf/sqlite-open';
import { TemporaryFiles } from '@zukhruf/testing/fs';

import {
  Catalog,
  Gauge,
  PassFinished,
  Source,
  type SourceMessage,
  Stream,
  passChannels,
} from '@eltjs/elt';
import { readPassStatus } from '@eltjs/elt-sqlite';
import { MacOSDocumentParser } from '@eltjs/source-apple-macos/macos-document-parser';
import { Settings } from '@workspace/settings';

import type { Choice } from './choice.ts';
import { Connector } from './connector.ts';

// A store that the first check of a watch reads as changed, and that never
// changes after it.
class Unchanging extends Gauge {
  protected async read() {
    return 0;
  }
}

// What an SDK throws when macOS denies its store; each store throws its own.
class StoreDeniedError extends Error {}

// One store of an app: each of its streams lists the records it is given,
// each record with the file it names, if any. It fails to open with the
// error the test gives it, and says a denial of its own store is the user's
// to fix.
class Store extends Source {
  readonly identity: string;
  protected readonly catalog: Catalog;
  readonly #records: Readonly<
    Record<string, readonly Record<string, string>[]>
  >;
  readonly #denied: new (message: string) => StoreDeniedError;
  opening: Error | null = null;

  constructor(
    identity: string,
    records: Readonly<Record<string, readonly Record<string, string>[]>>,
    denied: new (message: string) => StoreDeniedError,
  ) {
    super();
    this.identity = identity;
    this.#records = records;
    this.#denied = denied;
    this.catalog = new Catalog(
      Object.keys(records).map(
        (name) =>
          new Stream({
            name,
            jsonSchema: {
              type: 'object',
              description: `One ${name} record.`,
              properties: {
                id: { type: 'string', description: 'The record.' },
                name: { type: 'string', description: 'Its name.' },
              },
              required: ['id'],
            },
            primaryKey: ['id'],
            supportedSyncModes: ['full_refresh', 'incremental'],
            supportsFileTransfer: true,
            sourceDefinedCursor: true,
          }),
      ),
    );
  }

  override coverage() {
    return { description: 'Every record.', selection: {} };
  }

  override async currentAsOf() {
    return null;
  }

  override failureType(error: unknown) {
    return error instanceof this.#denied ? 'config' : 'system';
  }

  protected override async open() {
    if (this.opening !== null) throw this.opening;
    return new AsyncDisposableStack();
  }

  override changeSignals(streams: readonly Stream[]) {
    return [
      { gauge: new Unchanging(), streams, interval: 1000, timeout: 1000 },
    ];
  }

  // A read that resumes from the cursor of a read that ended finds nothing
  // new.
  protected override async *extract(
    configuration: { readonly stream: Stream },
    state: unknown,
  ): AsyncGenerator<SourceMessage> {
    const stream = configuration.stream.name;
    if (typeof state === 'object' && state !== null && 'read' in state) return;
    for (const { file, ...data } of this.#records[stream] ?? [])
      yield file === undefined ? { stream, data } : { stream, data, file };
    yield { type: 'STATE', stream, state: { read: true } };
  }
}

class TwoStoreConnector extends Connector {
  readonly datedBy = null;
  readonly fullDiskAccess = false;
  protected readonly choices: readonly Choice[];
  protected override readonly probe?: string;
  protected readonly unscoped = [];
  protected readonly storeCopies = [];
  readonly #sources: readonly [Source, Source];

  constructor(
    sources: readonly [Source, Source],
    choices: readonly Choice[] = [],
    probe?: string,
  ) {
    super(
      {
        clock: globalThis,
        grantee: 'Codex',
        documentParser: new MacOSDocumentParser(),
        home: '',
        env: {},
        eventKitHelper: '',
      },
      { name: 'two-stores', title: 'Two Stores', folder: '/nonexistent' },
    );
    this.#sources = sources;
    this.choices = choices;
    this.probe = probe;
  }

  protected access(): string {
    return 'Allow Codex to read both stores.';
  }

  protected sources() {
    return this.#sources;
  }
}

const choice = (stream: string): Choice => ({
  stream,
  scope: 'collectionIds',
  title: stream,
  id: ({ id }) => String(id),
  label: ({ name }) => String(name),
});

function selected(
  settings: Settings,
  connector: Connector,
  includeAttachments = false,
) {
  const selection = {
    connector: connector.name,
    scope: {},
    includeAttachments,
  };
  settings.select([selection], {
    facts: () => connector,
    permissions: () => connector.guidance(),
  });
  return selection;
}

function read(database: string, sql: string) {
  using data = open(database, { readOnly: true });
  return data
    .prepare(sql)
    .all()
    .map((row) => ({ ...row }));
}

test(
  'an import of a connector with two sources loads both into one file, with the text of the files each stored, and a rerun writes nothing',
  { timeout: 30_000 },
  async () => {
    await using scratch = await new TemporaryFiles().directory('sources-');
    await mkdir(join(scratch.path, 'Store'));
    const invoice = join(scratch.path, 'Store/invoice.txt');
    const receipt = join(scratch.path, 'Store/receipt.txt');
    await writeFile(invoice, 'Careem invoice 4471');
    await writeFile(receipt, 'Talabat receipt 9902');
    const connector = new TwoStoreConnector([
      new Store(
        'chromium:dia',
        { notes: [{ id: 'n1', file: invoice }] },
        StoreDeniedError,
      ),
      new Store(
        'dia-desktop',
        { archivedTabs: [{ id: 't1', file: receipt }] },
        StoreDeniedError,
      ),
    ]);
    using settings = new Settings(join(scratch.path, 'Imports'));
    const selection = selected(settings, connector, true);
    const written: number[] = [];
    const hear = (message: unknown) => {
      if (message instanceof PassFinished)
        written.push(
          ...message.outcomes.map(({ count, deleted }) => count + deleted),
        );
    };
    passChannels.finish.subscribe(hear);
    try {
      const first = await connector.import(settings, selection);
      const loaded = written.splice(0);
      const rerun = await connector.import(settings, selection);

      const database = settings.database(selection);
      assert.deepEqual(
        [first, rerun],
        [{ status: 'imported' }, { status: 'imported' }],
      );
      assert.deepEqual(loaded, [1, 1]);
      assert.deepEqual(written, [0, 0]);
      assert.deepEqual(read(database, 'SELECT id FROM notes'), [{ id: 'n1' }]);
      assert.deepEqual(read(database, 'SELECT id FROM archived_tabs'), [
        { id: 't1' },
      ]);
      assert.deepEqual(
        read(
          database,
          'SELECT connector, status FROM sync_status ORDER BY connector',
        ),
        [
          { connector: 'chromium:dia', status: 'succeeded' },
          { connector: 'dia-desktop', status: 'succeeded' },
        ],
      );
      assert.deepEqual(
        read(database, 'SELECT content FROM attachment_text ORDER BY content'),
        [
          { content: 'Careem invoice 4471' },
          { content: 'Talabat receipt 9902' },
        ],
      );
      assert.equal(readPassStatus(database).pass?.state, 'succeeded');
    } finally {
      passChannels.finish.unsubscribe(hear);
    }
  },
);

test(
  "a second source the user must grant leaves the import partial and the user's to fix, while the first source loads",
  { timeout: 30_000 },
  async () => {
    await using scratch = await new TemporaryFiles().directory('sources-');
    class NotesDeniedError extends StoreDeniedError {}
    class TabsDeniedError extends StoreDeniedError {}
    const tabs = new Store(
      'dia-desktop',
      { archivedTabs: [{ id: 't1' }] },
      TabsDeniedError,
    );
    const connector = new TwoStoreConnector([
      new Store('chromium:dia', { notes: [{ id: 'n1' }] }, NotesDeniedError),
      tabs,
    ]);
    using settings = new Settings(join(scratch.path, 'Imports'));
    const selection = selected(settings, connector);
    const denied = new TabsDeniedError('Dia’s archive is behind access.');
    tabs.opening = denied;

    const outcome = await connector.import(settings, selection);

    const database = settings.database(selection);
    const { pass } = readPassStatus(database);
    assert.deepEqual(outcome, { status: 'imported' });
    assert.deepEqual(read(database, 'SELECT id FROM notes'), [{ id: 'n1' }]);
    assert.deepEqual([pass?.state, pass?.failureType], ['partial', 'config']);
    assert.match(pass?.error ?? '', /Dia’s archive is behind access\./);
    assert.equal(connector.failureType(denied), 'config');
    assert.equal(
      connector.failureType(new NotesDeniedError('Notes are denied.')),
      'config',
    );
    assert.equal(
      connector.failureType(new Error('The archive is corrupt.')),
      'system',
    );
    assert.equal(
      connector.failure(denied),
      'Dia’s archive is behind access. — Allow Codex to read both stores.',
    );
  },
);

test('the choices of a connector are read from whichever of its sources declares each stream', async () => {
  const sources = () =>
    [
      new Store(
        'chromium:dia',
        { profiles: [{ id: 'p1', name: 'Work' }] },
        StoreDeniedError,
      ),
      new Store(
        'dia-desktop',
        { spaces: [{ id: 's1', name: 'Reading' }] },
        StoreDeniedError,
      ),
    ] as const;

  const listed = await new TwoStoreConnector(sources(), [
    choice('profiles'),
    choice('spaces'),
  ]).listChoices();
  // Reading the probe opens the store that declares it, so a denial of the
  // second store fails there.
  const [profiles, spaces] = sources();
  const denied = new StoreDeniedError('Dia’s spaces are behind access.');
  spaces.opening = denied;
  const probed = new TwoStoreConnector(
    [profiles, spaces],
    [],
    'spaces',
  ).choiceRows();
  const undeclared = new TwoStoreConnector(sources(), [
    choice('profiles'),
    choice('folders'),
  ]).listChoices();

  assert.deepEqual(
    listed.map(({ stream, options }) => [stream, options]),
    [
      ['profiles', [{ id: 'p1', label: 'Work' }]],
      ['spaces', [{ id: 's1', label: 'Reading' }]],
    ],
  );
  await assert.rejects(probed, (error) => error === denied);
  await assert.rejects(undeclared, {
    message:
      'No source of the Two Stores connector declares the stream folders',
  });
});

test(
  'two sources that declare one stream are refused as two writers of its table, not mixed in it',
  { timeout: 30_000 },
  async () => {
    await using scratch = await new TemporaryFiles().directory('sources-');
    const connector = new TwoStoreConnector([
      new Store(
        'chromium:dia',
        { notes: [{ id: 'chromium' }] },
        StoreDeniedError,
      ),
      new Store('dia-desktop', { notes: [{ id: 'dia' }] }, StoreDeniedError),
    ]);
    using settings = new Settings(join(scratch.path, 'Imports'));
    const selection = selected(settings, connector);

    const outcome = await connector.import(settings, selection);

    const database = settings.database(selection);
    const rows = read(database, 'SELECT id FROM raw_notes');
    const [owner, refused] =
      rows[0]?.id === 'dia'
        ? ['dia-desktop', 'chromium:dia']
        : ['chromium:dia', 'dia-desktop'];
    assert.deepEqual(outcome, { status: 'imported' });
    assert.equal(rows.length, 1);
    assert.deepEqual(
      read(
        database,
        'SELECT connector, status, error FROM sync_status ORDER BY connector',
      ).map(({ connector, status, error }) => [connector, status, error]),
      [owner, refused]
        .sort()
        .map((connection) =>
          connection === owner
            ? [owner, 'succeeded', null]
            : [
                refused,
                'failed',
                `The following copies did not load completely: ${refused}:notes: Target raw_notes is written by {"copy":"${owner}:notes"}; {"copy":"${refused}:notes"} cannot write it. A target has one writer; clear the owning copy, or drop the target, to reassign it.`,
              ],
        ),
    );
  },
);
