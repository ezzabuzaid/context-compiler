import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtempDisposable, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { Settings } from '@workspace/settings';

test('the CLI saves an installed model in its chosen directory, rejects unknown models and can turn it off', async () => {
  await using scratch = await mkdtempDisposable(
    join(tmpdir(), 'cli-transcription-'),
  );
  const snapshot = join(
    scratch.path,
    '.cache/huggingface/hub/models--ggerganov--whisper.cpp/snapshots/a1',
  );
  await mkdir(snapshot, { recursive: true });
  // A whisper.cpp model's magic is enough for discovery to list the model;
  // its engine fails to load these bytes and exits.
  await writeFile(join(snapshot, 'ggml-small.bin'), 'lmgg');
  const directory = join(scratch.path, 'imports');
  const run = (id: string) =>
    spawnSync(
      process.execPath,
      [
        join(import.meta.dirname, 'main.js'),
        '--directory',
        directory,
        '--transcription-model',
        id,
        'status',
      ],
      {
        env: { ...process.env, HOME: scratch.path },
        encoding: 'utf8',
        timeout: 30_000,
      },
    );
  const enabled = run('ggml-small.bin');
  assert.equal(enabled.status, 0, enabled.stderr);
  using settings = new Settings(directory);
  assert.equal(settings.transcription(), 'ggml-small.bin');
  assert.equal(run('missing').status, 1);
  assert.equal(settings.transcription(), 'ggml-small.bin');
  const disabled = run('off');
  assert.equal(disabled.status, 0, disabled.stderr);
  assert.equal(settings.transcription(), null);
});
