import assert from 'node:assert/strict';
import { mkdir, mkdtempDisposable, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { SpeechModels } from '@workspace/sdk-macos-speech-models';
import { Settings } from '@workspace/settings';
import { Vision } from '@workspace/source-apple-macos/vision';

import { AttachmentText } from './attachment-text.ts';
import { Transcription } from './transcription.ts';

test('an existing attachment reader observes a model saved or disabled by another host', async () => {
  await using directory = await mkdtempDisposable(
    join(tmpdir(), 'transcription-host-'),
  );
  const audio = join(directory.path, 'voice.opus');
  const database = join(directory.path, 'data.sqlite');
  await writeFile(audio, Buffer.from([0, 1, 2, 3]));
  using data = new DatabaseSync(database);
  data.exec(
    'CREATE TABLE files (attachmentRef TEXT); CREATE VIEW documents AS SELECT * FROM files',
  );
  data.prepare('INSERT INTO files VALUES (?)').run('voice.opus');
  // A whisper.cpp model's magic is enough for discovery to list the model.
  const snapshot = join(
    directory.path,
    'hub/models--ggerganov--whisper.cpp/snapshots/a1',
  );
  await mkdir(snapshot, { recursive: true });
  await writeFile(join(snapshot, 'ggml-small.bin'), 'lmgg');
  await using vision = new Vision(
    fileURLToPath(
      import.meta.resolve('@workspace/source-apple-macos/vision-worker'),
    ),
  );
  await using host = new Transcription(
    directory.path,
    new SpeechModels({
      hub: join(directory.path, 'hub'),
      home: directory.path,
    }),
    vision,
  );
  using other = new Settings(directory.path);
  const reader = new AttachmentText(
    database,
    directory.path,
    ['documents'],
    () => host.parser,
  );
  await reader.update(new AbortController().signal);
  assert.equal(
    data.prepare('SELECT status FROM attachment_text').get()?.status,
    'no_text',
  );
  other.setTranscription('ggml-small.bin');
  await host.refresh();
  const identity = await host.parser.identityFor(audio);
  assert.ok(identity?.includes('ggml-small.bin'));
  // The real decoder fails on these deliberately corrupt bytes. Its failure
  // proves that the already-constructed reader used the newly enabled model.
  await reader.update(new AbortController().signal);
  assert.equal(
    data.prepare('SELECT status FROM attachment_text').get()?.status,
    'failed',
  );
  // A model not installed on this Mac reads no audio.
  other.setTranscription('missing');
  await host.refresh();
  assert.notEqual(await host.parser.identityFor(audio), identity);
  other.setTranscription(null);
  await host.refresh();
  await reader.update(new AbortController().signal);
  assert.equal(
    data.prepare('SELECT status FROM attachment_text').get()?.status,
    'no_text',
  );
});
