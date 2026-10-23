import assert from 'node:assert/strict';
import { cp, mkdir, mkdtempDisposable, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { Settings } from '@workspace/settings';

test('the bundled page tools discover models, save the selection and reject an unavailable model', async () => {
  await using scratch = await mkdtempDisposable(
    join(tmpdir(), 'page-transcription-'),
  );
  const snapshot = join(
    scratch.path,
    '.cache/huggingface/hub/models--ggerganov--whisper.cpp/snapshots/a1',
  );
  await mkdir(snapshot, { recursive: true });
  // Only discovery runs: no connector is selected and no weights are loaded.
  await writeFile(join(snapshot, 'ggml-small.bin'), 'lmgg');
  const client = new Client({ name: 'transcription-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve('plugins/context-compiler/server/main.mjs')],
    env: {
      HOME: scratch.path,
      PATH: process.env.PATH ?? '',
      CONTEXT_COMPILER_GRANTEE: 'Context Compiler',
    },
    stderr: 'pipe',
  });
  try {
    await client.connect(transport);
    const listed = await client.callTool({
      name: 'transcription',
      arguments: {},
    });
    assert.equal(listed.isError, undefined);
    assert.deepEqual(listed.structuredContent, {
      selected: null,
      models: [{ id: 'ggml-small.bin', title: 'ggml-small' }],
    });
    const enabled = await client.callTool({
      name: 'transcription_update',
      arguments: { model: 'ggml-small.bin' },
    });
    assert.equal(enabled.isError, undefined);
    using settings = new Settings(
      join(
        scratch.path,
        'Library/Application Support/Context Compiler/Imports',
      ),
    );
    assert.equal(settings.transcription(), 'ggml-small.bin');
    const unavailable = await client.callTool({
      name: 'transcription_update',
      arguments: { model: 'missing' },
    });
    assert.equal(unavailable.isError, true);
    assert.equal(settings.transcription(), 'ggml-small.bin');
    const disabled = await client.callTool({
      name: 'transcription_update',
      arguments: { model: null },
    });
    assert.equal(disabled.isError, undefined);
    assert.equal(settings.transcription(), null);
  } finally {
    await client.close();
    await transport.close();
  }
});

// A home with a speech model in its Hugging Face cache, and the plugin store
// in it.
async function homeWithModel(home: string) {
  const snapshot = join(
    home,
    '.cache/huggingface/hub/models--ggerganov--whisper.cpp/snapshots/a1',
  );
  await mkdir(snapshot, { recursive: true });
  await writeFile(join(snapshot, 'ggml-small.bin'), 'lmgg');
  return {
    store: join(home, 'Library/Application Support/Context Compiler/Imports'),
  };
}

// A launcher with no chat delivery.
async function pageTool(home: string, name: string, args: object) {
  const client = new Client({ name: 'transcription-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve('plugins/context-compiler/server/main.mjs')],
    env: {
      HOME: home,
      PATH: process.env.PATH ?? '',
      CONTEXT_COMPILER_GRANTEE: 'Context Compiler',
    },
    stderr: 'pipe',
  });
  try {
    await client.connect(transport);
    return await client.callTool({ name, arguments: { ...args } });
  } finally {
    await client.close();
    await transport.close();
  }
}

test('a store moved to another Mac keeps its chosen model, found where it is installed there', async () => {
  await using scratch = await mkdtempDisposable(
    join(tmpdir(), 'page-transcription-moved-'),
  );
  const before = await homeWithModel(join(scratch.path, 'before'));
  const after = await homeWithModel(join(scratch.path, 'after'));
  await pageTool(join(scratch.path, 'before'), 'transcription_update', {
    model: 'ggml-small.bin',
  });

  // Migration Assistant copies the store to a home with another name; the
  // old Mac, and its model, are gone.
  await cp(before.store, after.store, { recursive: true });
  await rm(join(scratch.path, 'before'), { recursive: true });
  const listed = await pageTool(
    join(scratch.path, 'after'),
    'transcription',
    {},
  );

  assert.equal(listed.isError, undefined);
  assert.deepEqual(listed.structuredContent, {
    selected: 'ggml-small.bin',
    models: [{ id: 'ggml-small.bin', title: 'ggml-small' }],
  });
});
