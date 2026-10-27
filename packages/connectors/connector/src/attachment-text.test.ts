import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync } from 'node:fs';
import {
  chmod,
  mkdir,
  mkdtempDisposable,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { availableParallelism, tmpdir } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { MockTranscriptionModelV4 } from 'ai/test';

import {
  Catalog,
  type CopyConfiguration,
  DocumentParser,
  type PassObserver,
  Pipeline,
  Source,
  type SourceMessage,
  type SourceWatchOptions,
  Stream,
} from '@workspace/elt';
import { SQLiteSyncHistory, type SQLiteTable } from '@workspace/elt-sqlite';
import { AudioFormat } from '@workspace/source-apple-macos/audio-format';
import { MacOSDocumentParser } from '@workspace/source-apple-macos/macos-document-parser';

import { Connector } from './connector.ts';

const readers = availableParallelism();

// A source whose upstream is current whenever it is read.
abstract class LiveSource<
  Context extends AsyncDisposable = AsyncDisposable,
> extends Source<Context> {
  override async currentAsOf() {
    return null;
  }
}

// An app that keeps files in a folder: one record per file, its copy stored
// as Connector stores attachments, and deleted once its file is. It reports a
// change each time the test says the folder changed.
class FolderSource extends LiveSource {
  readonly identity = 'folder';
  protected readonly catalog = new Catalog([
    new Stream({
      name: 'documents',
      jsonSchema: {
        type: 'object',
        description: 'One record per file in the folder.',
        properties: {
          name: { type: 'string', description: 'The file name in the folder.' },
        },
        required: ['name'],
      },
      primaryKey: ['name'],
      supportedSyncModes: ['incremental'],
      supportsFileTransfer: true,
      sourceDefinedCursor: true,
      emitsDeletes: true,
    }),
  ]);
  readonly #folder: string;
  #change = Promise.withResolvers<void>();

  constructor(folder: string) {
    super();
    this.#folder = folder;
  }

  changed() {
    this.#change.resolve();
  }

  override coverage() {
    return { description: 'Every file in the folder.', selection: {} };
  }

  protected override async open() {
    return new AsyncDisposableStack();
  }

  protected override async *observe({ streams, signal }: SourceWatchOptions) {
    yield streams;
    const stopped = new Promise((resolve) =>
      signal.addEventListener('abort', resolve, { once: true }),
    );
    while (!signal.aborted) {
      await Promise.race([this.#change.promise, stopped]);
      if (signal.aborted) return;
      this.#change = Promise.withResolvers();
      yield streams;
    }
  }

  // Every file each run, and a deletion for each file gone since the last.
  protected override async *extract(
    _configuration: CopyConfiguration,
    state: unknown,
  ): AsyncGenerator<SourceMessage> {
    const names = (await readdir(this.#folder)).sort();
    for (const name of names)
      yield {
        stream: 'documents',
        data: { name },
        file: join(this.#folder, name),
      };
    if (Array.isArray(state))
      for (const name of state)
        if (typeof name === 'string' && !names.includes(name))
          yield { type: 'DELETE', stream: 'documents', key: { name } };
    yield { type: 'STATE', stream: 'documents', state: names };
  }
}

// The host's parser is the one the test last chose, as a host's is the
// transcription choice saved last.
class FolderConnector extends Connector {
  readonly datedBy = null;
  readonly fullDiskAccess = false;
  protected readonly choices = [];
  protected readonly unscoped = [];
  protected readonly storeCopies = [];
  readonly #source: FolderSource;

  constructor(host: { documentParser: DocumentParser }, source: FolderSource) {
    super(
      {
        grantee: 'Codex',
        get documentParser() {
          return host.documentParser;
        },
        eventKitHelper: '',
      },
      { name: 'folder', title: 'Folder', folder: '/nonexistent' },
    );
    this.#source = source;
  }

  protected access(): string {
    return 'Nothing to grant.';
  }

  protected source() {
    return this.#source;
  }
}

// One import as a host keeps it, in directory: the pipeline Connector builds
// from its connection and derived datasets, over a folder in upstream.
async function importStore(
  directory: string,
  upstream = join(directory, 'upstream'),
) {
  await mkdir(upstream, { recursive: true });
  const host: { documentParser: DocumentParser } = {
    documentParser: new MacOSDocumentParser(),
  };
  const source = new FolderSource(upstream);
  const connector = new FolderConnector(host, source);
  const imported = join(directory, 'import');
  const path = join(imported, 'data.sqlite');
  const pipeline = async (observer?: PassObserver<SQLiteTable>) => {
    const { connection, derived } = await connector.connection(imported, {
      connector: connector.name,
      scope: {},
      includeAttachments: true,
    });
    return new Pipeline({
      connections: [connection],
      history: new SQLiteSyncHistory({ soleWriter: true }),
      observer,
      derived,
    });
  };
  const read = (sql: string) => {
    using database = new DatabaseSync(path, { readOnly: true });
    return database
      .prepare(sql)
      .all()
      .map((row) => ({ ...row }));
  };
  return {
    imported,
    source,
    put: (name: string, content: string) =>
      writeFile(join(upstream, name), content),
    remove: (name: string) => rm(join(upstream, name)),
    // The pipeline a host watches with, reading text with parser.
    watching: (parser: DocumentParser) => {
      host.documentParser = parser;
      return pipeline();
    },
    // One sync as a host runs it: a pass, then the text of what it stored.
    sync: async (
      parser: DocumentParser,
      {
        signal,
        observer,
      }: { signal?: AbortSignal; observer?: PassObserver<SQLiteTable> } = {},
    ) => {
      host.documentParser = parser;
      await (await pipeline(observer)).run({ signal });
    },
    read,
    // What a reader searching attachment text sees, by document; none before
    // the first refresh creates its view.
    texts: () =>
      read(
        `SELECT 1 FROM sqlite_schema WHERE name IN ('attachment_text', 'documents')`,
      ).length < 2
        ? []
        : read(
            `SELECT d.name, t.status, t.content, t.error, t.rule
             FROM documents d JOIN attachment_text t ON t.ref = d.attachmentRef
             ORDER BY d.name`,
          ),
  };
}

// A parser that reads nothing: every file is a format it does not handle, so
// a sync with it loads the import and leaves the text unread.
class NoFormatParser extends DocumentParser {
  constructor() {
    super('no-format');
  }

  override async identityFor() {
    return null;
  }

  override async parse(): Promise<string | null> {
    throw new Error('No format is handled');
  }
}

// The real parser, counting what it is asked to read: whether a sync read a
// file has no other output a test can see.
class CountingParser extends DocumentParser {
  readonly read: string[] = [];
  readonly #parser = new MacOSDocumentParser();

  constructor(identity = new MacOSDocumentParser().identity) {
    super(identity);
  }

  override identityFor(path: string) {
    return this.identity === this.#parser.identity
      ? this.#parser.identityFor(path)
      : super.identityFor(path);
  }

  override parse(path: string) {
    this.read.push(path);
    return this.#parser.parse(path);
  }
}

// The real parser, holding each file whose text contains "hold" until
// release(). The real one cannot be made to take long on demand.
class HoldingParser extends DocumentParser {
  inFlight = 0;
  peak = 0;
  readonly #parser = new MacOSDocumentParser();
  readonly #release = Promise.withResolvers<void>();

  constructor() {
    super(new MacOSDocumentParser().identity);
  }

  override identityFor(path: string) {
    return this.#parser.identityFor(path);
  }

  release() {
    this.#release.resolve();
  }

  override async parse(path: string) {
    this.inFlight += 1;
    this.peak = Math.max(this.peak, this.inFlight);
    try {
      if ((await readFile(path, 'utf8')).includes('hold'))
        await this.#release.promise;
      return await this.#parser.parse(path);
    } finally {
      this.inFlight -= 1;
    }
  }
}

// Waits until check() holds, polling, or fails after a deadline.
async function eventually(check: () => boolean, what: string) {
  const deadline = Date.now() + 20_000;
  while (!check()) {
    if (Date.now() > deadline) assert.fail(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

// One page with a line of text in Helvetica: a PDF with a text layer.
function textPdf(text: string): string {
  const content = `BT /F1 18 Tf 20 100 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = body.length;
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return body;
}

test('an unreadable file loads as failed with its error, and the sync still reads every other file', async () => {
  await using directory = await mkdtempDisposable(join(tmpdir(), 'att-'));
  const store = await importStore(directory.path);
  await store.put('invoice.txt', 'Careem invoice 4471');
  await store.put('corrupt.pdf', 'not a pdf');
  await store.put('note.txt', 'Dinner at eight');

  await store.sync(new MacOSDocumentParser());

  const texts = store.texts();
  assert.deepEqual(
    texts.map(({ name, status, content }) => ({ name, status, content })),
    [
      { name: 'corrupt.pdf', status: 'failed', content: null },
      {
        name: 'invoice.txt',
        status: 'computed',
        content: 'Careem invoice 4471',
      },
      { name: 'note.txt', status: 'computed', content: 'Dinner at eight' },
    ],
  );
  assert.match(String(texts[0]?.error), /Cannot read PDF/);
});

test('a file whose read failed is read again on the next sync', async () => {
  await using directory = await mkdtempDisposable(join(tmpdir(), 'att-'));
  const store = await importStore(directory.path);
  await store.put('invoice.txt', 'Careem invoice 4471');
  // The real parser fails only for reasons a test cannot switch on and off,
  // such as Vision under a sandbox or an osascript timeout.
  const flaky = new (class extends DocumentParser {
    failures = 1;
    readonly #parser = new MacOSDocumentParser();
    override parse(path: string) {
      if (this.failures-- > 0) throw new Error('Vision failed');
      return this.#parser.parse(path);
    }
  })(new MacOSDocumentParser().identity);
  await store.sync(flaky);
  assert.equal(store.texts()[0]?.status, 'failed');

  await store.sync(flaky);

  assert.deepEqual(
    store.texts().map(({ status, content }) => ({ status, content })),
    [{ status: 'computed', content: 'Careem invoice 4471' }],
  );
});

test('a stored copy removed while it is read leaves no row and no failure', async () => {
  await using directory = await mkdtempDisposable(join(tmpdir(), 'att-'));
  const store = await importStore(directory.path);
  await store.put('invoice.txt', 'Careem invoice 4471');
  // Only a commit that lands mid-read removes a copy, and a test cannot time
  // a real commit into that window, so the parser removes it first.
  const racing = new (class extends DocumentParser {
    readonly #parser = new MacOSDocumentParser();
    override async parse(path: string) {
      await rm(path);
      return this.#parser.parse(path);
    }
  })(new MacOSDocumentParser().identity);

  await store.sync(racing);

  assert.deepEqual(store.read('SELECT ref, status FROM attachment_text'), []);
});

test(
  'a file that is slow to read holds only its own place when the device has spare capacity',
  { skip: readers < 2 },
  async () => {
    await using directory = await mkdtempDisposable(join(tmpdir(), 'att-'));
    const store = await importStore(directory.path);
    await store.put('a-slow.txt', 'hold until released');
    for (const name of ['b', 'c', 'd', 'e', 'f', 'g'])
      await store.put(`${name}.txt`, `text of ${name}`);
    const parser = new HoldingParser();

    const sync = store.sync(parser);
    try {
      await eventually(() => parser.inFlight > 0, 'the reads to start');
      await eventually(
        () =>
          store.texts().filter(({ name }) => name !== 'a-slow.txt').length ===
          6,
        'every file but the held one to be read',
      );
      assert.ok(parser.peak > 1 && parser.peak <= readers);
    } finally {
      parser.release();
      await sync;
    }
    assert.deepEqual(
      store.texts().map(({ name, status }) => [name, status]),
      ['a-slow', 'b', 'c', 'd', 'e', 'f', 'g'].map((name) => [
        `${name}.txt`,
        'computed',
      ]),
    );
  },
);

test('a watched import loads and commits its rows while a file is still being read', async () => {
  await using directory = await mkdtempDisposable(join(tmpdir(), 'att-'));
  const store = await importStore(directory.path);
  await store.put('slow.txt', 'hold until released');
  const parser = new HoldingParser();
  const stop = new AbortController();
  const passes = (await store.watching(parser)).watch({ signal: stop.signal });
  try {
    await passes.next();
    await eventually(() => parser.inFlight === 1, 'the held read to start');
    await store.put('invoice.txt', 'Careem invoice 4471');
    store.source.changed();

    await passes.next();

    assert.deepEqual(store.read('SELECT name FROM documents ORDER BY name'), [
      { name: 'invoice.txt' },
      { name: 'slow.txt' },
    ]);
    assert.equal(parser.inFlight, 1);
  } finally {
    parser.release();
    stop.abort();
    await passes.return(undefined);
  }
});

test('a sync stopped while files are read keeps the text it read, and the next sync reads the rest', async () => {
  await using directory = await mkdtempDisposable(join(tmpdir(), 'att-'));
  const store = await importStore(directory.path);
  // Whichever reads start first stay held, leaving the rest queued.
  const files = readers + 2;
  for (let index = 0; index < files; index++)
    await store.put(`${index}-held.txt`, `hold ${index}`);
  const parser = new HoldingParser();
  const stop = new AbortController();
  const sync = store.sync(parser, { signal: stop.signal });
  try {
    await eventually(() => parser.inFlight > 0, 'a read held');
  } finally {
    stop.abort();
    parser.release();
    await sync;
  }
  // The reads that started kept their text.
  const completed = store.texts().length;
  assert.ok(completed > 0 && completed <= readers);
  const counting = new CountingParser();

  await store.sync(counting);

  assert.equal(counting.read.length, files - completed);
  assert.equal(store.texts().length, files);
});

test('a read that fails for a reason other than the file being gone fails the sync, and stops it taking more files', async () => {
  await using directory = await mkdtempDisposable(join(tmpdir(), 'att-'));
  const store = await importStore(directory.path);
  for (let index = 0; index < readers + 2; index++)
    await store.put(`${index}.txt`, `text ${index}`);
  await store.sync(new NoFormatParser());
  const stored = dirname(
    join(
      store.imported,
      'files',
      String(store.read('SELECT attachmentRef AS ref FROM documents')[0]?.ref),
    ),
  );
  // The stored copies' directory, made unreadable once the pass committed, as
  // permissions can leave it: the parser cannot open a copy, nor the sync tell
  // whether it is gone.
  const unreadable: PassObserver<SQLiteTable> = {
    begin: () => ({
      progress: () => undefined,
      fail: () => undefined,
      finish: () => chmodSync(stored, 0o000),
    }),
  };
  const parser = new CountingParser('macos-document-next');
  try {
    await assert.rejects(
      store.sync(parser, { observer: unreadable }),
      /EACCES/,
    );

    assert.ok(
      parser.read.length <= readers,
      `read ${parser.read.length} files`,
    );
  } finally {
    await chmod(stored, 0o700);
  }
});

test('a sync of an import with no files yet reads nothing and fails nothing', async () => {
  await using directory = await mkdtempDisposable(join(tmpdir(), 'att-'));
  const store = await importStore(directory.path);
  const parser = new CountingParser();

  await store.sync(parser);

  assert.deepEqual(parser.read, []);
  assert.deepEqual(store.read('SELECT ref FROM attachment_text'), []);
});

test('a reader finds a stored file by its text: text and PDF files load their text, a file with no text loads empty', async () => {
  await using directory = await mkdtempDisposable(join(tmpdir(), 'att-'));
  const store = await importStore(directory.path);
  const contents = {
    'note.txt': 'Dinner at eight',
    'receipt.pdf': textPdf('Careem invoice 4471'),
    'blob.bin': '\u0001\u0002\u0003 binary',
  };
  for (const [name, content] of Object.entries(contents))
    await store.put(name, content);

  await store.sync(new MacOSDocumentParser());

  assert.deepEqual(
    store.read(
      `SELECT d.name FROM documents d JOIN attachment_text t ON t.ref = d.attachmentRef
       WHERE t.content LIKE '%invoice 4471%'`,
    ),
    [{ name: 'receipt.pdf' }],
  );
  assert.deepEqual(
    store.texts().map(({ name, status }) => [name, status]),
    [
      ['blob.bin', 'empty'],
      ['note.txt', 'computed'],
      ['receipt.pdf', 'computed'],
    ],
  );
  // The ref names the stored copy by the SHA-256 of its bytes.
  assert.deepEqual(
    store
      .read(
        'SELECT d.name, t.ref FROM documents d JOIN attachment_text t ON t.ref = d.attachmentRef ORDER BY d.name',
      )
      .map(({ name, ref }) => [
        name,
        basename(String(ref), extname(String(ref))),
      ]),
    Object.entries(contents)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, content]) => [
        name,
        createHash('sha256').update(content).digest('hex'),
      ]),
  );
  assert.deepEqual(
    store.read(
      `SELECT name FROM catalog WHERE name LIKE 'attachment_text%' ORDER BY name`,
    ),
    [
      'attachment_text',
      ...['content', 'error', 'input_hash', 'ref', 'rule', 'status'].map(
        (column) => `attachment_text.${column}`,
      ),
    ].map((name) => ({ name })),
  );
});

test('a sync with nothing new reads no file', async () => {
  await using directory = await mkdtempDisposable(join(tmpdir(), 'att-'));
  const store = await importStore(directory.path);
  await store.put('note.txt', 'Dinner at eight');
  await store.put('invoice.txt', 'Careem invoice 4471');
  await store.put('blob.bin', '\u0001\u0002\u0003 binary');
  await store.sync(new MacOSDocumentParser());
  const parser = new CountingParser();

  await store.sync(parser);

  assert.deepEqual(parser.read, []);
  assert.equal(store.texts().length, 3);
});

test('a parser with a new identity reads every file again', async () => {
  await using directory = await mkdtempDisposable(join(tmpdir(), 'att-'));
  const store = await importStore(directory.path);
  await store.put('note.txt', 'Dinner at eight');
  await store.put('invoice.txt', 'Careem invoice 4471');
  await store.sync(new MacOSDocumentParser());
  const upgraded = new CountingParser('macos-document-next');

  await store.sync(upgraded);

  assert.equal(upgraded.read.length, 2);
  assert.deepEqual(
    store.texts().map(({ name, rule }) => [name, rule]),
    [
      ['invoice.txt', 'macos-document-next'],
      ['note.txt', 'macos-document-next'],
    ],
  );
});

test('a file the import deletes loses its text on the next sync', async () => {
  await using directory = await mkdtempDisposable(join(tmpdir(), 'att-'));
  const store = await importStore(directory.path);
  await store.put('note.txt', 'Dinner at eight');
  await store.put('invoice.txt', 'Careem invoice 4471');
  await store.sync(new MacOSDocumentParser());
  await store.remove('invoice.txt');

  await store.sync(new MacOSDocumentParser());

  assert.deepEqual(store.read('SELECT content FROM attachment_text'), [
    { content: 'Dinner at eight' },
  ]);
});

test('one file attached in three chats is read once, and all three find its text', async () => {
  await using directory = await mkdtempDisposable(join(tmpdir(), 'att-'));
  const store = await importStore(directory.path);
  for (const chat of ['family', 'work', 'friends'])
    await store.put(`${chat}-invoice.txt`, 'Careem invoice 4471');
  const parser = new CountingParser();

  await store.sync(parser);

  assert.equal(parser.read.length, 1);
  assert.deepEqual(
    store.texts().map(({ name, content }) => [name, content]),
    ['family', 'friends', 'work'].map((chat) => [
      `${chat}-invoice.txt`,
      'Careem invoice 4471',
    ]),
  );
});

// AI SDK's provider stand-in lets one test change a model's answer without
// credentials or downloading different weights. Dispatch and storage are real.
test('enabling or changing an audio model processes stored audio; disabling keeps its transcript', async () => {
  await using directory = await mkdtempDisposable(join(tmpdir(), 'att-audio-'));
  const store = await importStore(directory.path);
  await store.put('note.txt', 'Keep this document');
  await store.put('voice.opus', '\u0000audio');
  await store.sync(new MacOSDocumentParser());
  assert.equal(store.texts()[1]?.status, 'empty');
  const model = (id: string) =>
    new MockTranscriptionModelV4({
      modelId: id,
      doGenerate: async () => ({
        text: id,
        segments: [],
        language: undefined,
        durationInSeconds: undefined,
        warnings: [],
        response: { timestamp: new Date(), modelId: id },
      }),
    });
  await store.sync(new MacOSDocumentParser([new AudioFormat(model('first'))]));
  assert.deepEqual(
    store.texts().map(({ content }) => content),
    ['Keep this document', 'first'],
  );
  // A native document already read keeps its existing identity and content.
  const document = store.texts()[0];
  await store.sync(new MacOSDocumentParser([new AudioFormat(model('second'))]));
  assert.deepEqual(store.texts()[0], document);
  assert.equal(store.texts()[1]?.content, 'second');
  await store.sync(new MacOSDocumentParser());
  assert.equal(store.texts()[1]?.content, 'second');
  await store.put('new.opus', '\u0000new audio');
  await store.sync(new MacOSDocumentParser());
  assert.equal(
    store.texts().find(({ name }) => name === 'new.opus')?.status,
    'empty',
  );
});

test('a moved import reads the text of its stored files', async () => {
  await using directory = await mkdtempDisposable(join(tmpdir(), 'att-'));
  const upstream = join(directory.path, 'upstream');
  const before = await importStore(join(directory.path, 'before'), upstream);
  await before.put('note.txt', 'milk and eggs');
  await before.sync(new NoFormatParser());

  // The import's folder moves to another disk or home, files and all.
  await rename(join(directory.path, 'before'), join(directory.path, 'after'));
  const after = await importStore(join(directory.path, 'after'), upstream);
  await after.sync(new MacOSDocumentParser());

  assert.deepEqual(
    after.texts().map(({ name, status, content }) => ({
      name,
      status,
      content,
    })),
    [{ name: 'note.txt', status: 'computed', content: 'milk and eggs' }],
  );
});
