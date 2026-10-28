import assert from 'node:assert/strict';
import { mkdir, mkdtempDisposable, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { Fixed, LeaderFirst, Pool } from '@zukhruf/pool';

import {
  Catalog,
  Pipeline,
  Source,
  type SourceMessage,
  type SourceWatchOptions,
  Stream,
} from '@workspace/elt';
import { SQLiteSyncHistory } from '@workspace/elt-sqlite';
import { SpeechModels } from '@workspace/sdk-macos-speech-models';
import { Settings } from '@workspace/settings';
import { VisionWorker } from '@workspace/source-apple-macos/vision';

import { Connector, type ConnectorHost } from './connector.ts';
import { Transcription } from './transcription.ts';

// An app with one voice note in its store, whose copy the import stores.
class VoiceNoteSource extends Source {
  readonly identity = 'voice-note';
  protected readonly catalog = new Catalog([
    new Stream({
      name: 'documents',
      jsonSchema: {
        type: 'object',
        description: 'One file.',
        properties: { name: { type: 'string', description: 'The file.' } },
        required: ['name'],
      },
      primaryKey: ['name'],
      supportedSyncModes: ['incremental'],
      supportsFileTransfer: true,
      sourceDefinedCursor: true,
    }),
  ]);
  readonly #file: string;

  constructor(file: string) {
    super();
    this.#file = file;
  }

  override async currentAsOf() {
    return null;
  }

  override coverage() {
    return { description: 'The voice note.', selection: {} };
  }

  protected override async open() {
    return new AsyncDisposableStack();
  }

  protected override async *observe({ streams }: SourceWatchOptions) {
    yield streams;
  }

  protected override async *extract(): AsyncGenerator<SourceMessage> {
    yield {
      stream: 'documents',
      data: { name: 'voice.opus' },
      file: this.#file,
    };
    yield { type: 'STATE', stream: 'documents', state: null };
  }
}

class VoiceNoteConnector extends Connector {
  readonly datedBy = null;
  readonly fullDiskAccess = false;
  protected readonly choices = [];
  protected readonly unscoped = [];
  protected readonly storeCopies = [];
  readonly #file: string;

  constructor(host: ConnectorHost, file: string) {
    super(host, {
      name: 'voice-note',
      title: 'Voice Note',
      folder: '/nonexistent',
    });
    this.#file = file;
  }

  protected access(): string {
    return 'Nothing to grant.';
  }

  protected source() {
    return new VoiceNoteSource(this.#file);
  }
}

test('an existing import pipeline reads audio with a model saved or disabled by another host', async () => {
  await using directory = await mkdtempDisposable(
    join(tmpdir(), 'transcription-host-'),
  );
  const audio = join(directory.path, 'voice.opus');
  await writeFile(audio, Buffer.from([0, 1, 2, 3]));
  // A whisper.cpp model's magic is enough for discovery to list the model.
  const snapshot = join(
    directory.path,
    'hub/models--ggerganov--whisper.cpp/snapshots/a1',
  );
  await mkdir(snapshot, { recursive: true });
  await writeFile(join(snapshot, 'ggml-small.bin'), 'lmgg');
  await using ocr = new Pool({
    size: new Fixed(1),
    startup: new LeaderFirst(),
    create: () =>
      new VisionWorker(
        fileURLToPath(
          import.meta.resolve('@workspace/source-apple-macos/vision-worker'),
        ),
      ),
  });
  await using host = new Transcription(
    directory.path,
    new SpeechModels({
      hub: join(directory.path, 'hub'),
      home: directory.path,
    }),
    ocr,
    fileURLToPath(
      import.meta.resolve('@workspace/transcription-local/transcribe-local'),
    ),
  );
  using other = new Settings(directory.path);
  // The host offers its connectors the parser of the choice it read last, as
  // the plugin's server does.
  const connector = new VoiceNoteConnector(
    {
      grantee: 'Codex',
      get documentParser() {
        return host.parser;
      },
      eventKitHelper: '',
    },
    audio,
  );
  const imported = join(directory.path, 'import');
  const { connection, derived } = await connector.connection(imported, {
    connector: connector.name,
    scope: {},
    includeAttachments: true,
  });
  const pipeline = new Pipeline({
    connections: [connection],
    history: new SQLiteSyncHistory({ soleWriter: true }),
    derived,
  });
  const status = () => {
    using data = new DatabaseSync(join(imported, 'data.sqlite'), {
      readOnly: true,
    });
    return data.prepare('SELECT status FROM attachment_text').get()?.status;
  };
  await pipeline.run();
  assert.equal(status(), 'empty');
  other.setTranscription('ggml-small.bin');
  await host.refresh();
  const identity = await host.parser.identityFor(audio);
  assert.ok(identity?.includes('ggml-small.bin'));
  // The real decoder fails on these deliberately corrupt bytes. Its failure
  // proves that the already-built pipeline used the newly enabled model.
  await pipeline.run();
  assert.equal(status(), 'failed');
  // A model not installed on this Mac reads no audio.
  other.setTranscription('missing');
  await host.refresh();
  assert.notEqual(await host.parser.identityFor(audio), identity);
  other.setTranscription(null);
  await host.refresh();
  await pipeline.run();
  assert.equal(status(), 'empty');
});
