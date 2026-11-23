import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { TemporaryFiles, isErrno } from '@zukhruf/fs';
import { waitFor } from '@zukhruf/testing/async';

// The workspace root: the tests read its fixtures and builds from any
// working directory.
const workspace = resolve(import.meta.dirname, '../../..');

async function children(parent: number) {
  const { stdout } = await promisify(execFile)('/bin/ps', [
    '-axo',
    'pid=,ppid=,comm=',
  ]);
  return stdout
    .trim()
    .split('\n')
    .flatMap((line) => {
      const [pid, ppid, command] = line.trim().split(/\s+/);
      return Number(ppid) === parent
        ? [{ pid: Number(pid), command: command! }]
        : [];
    });
}

async function ocrWorkers(parent: number) {
  return (await children(parent)).flatMap(({ pid, command }) =>
    command.endsWith('/vision-worker') ? [pid] : [],
  );
}

for (const shutdown of ['stdin', 'SIGTERM'] as const)
  test(`the MCP server starts OCR before any tool call, reuses it across settings changes and stops it on ${shutdown}`, async (t) => {
    await using home = await new TemporaryFiles().directory('server-ocr-');
    const model = join(
      home.path,
      '.cache/huggingface/hub/models--ggerganov--whisper.cpp/snapshots/a1',
    );
    await mkdir(model, { recursive: true });
    await writeFile(join(model, 'ggml-small.bin'), 'lmgg');
    // Records each SIGTERM that the server gets. The server keeps its own
    // SIGTERM handler, so the record changes nothing that the server does.
    const signals = join(home.path, 'signals.log');
    const recorder = join(home.path, 'record-sigterm.mjs');
    await writeFile(
      recorder,
      `import { appendFileSync } from 'node:fs';\nprocess.on('SIGTERM', () => appendFileSync(${JSON.stringify(signals)}, 'SIGTERM\\n'));\n`,
    );
    const client = new Client({ name: 'ocr-test', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        '--import',
        pathToFileURL(recorder).href,
        resolve(workspace, 'plugins/context-compiler/server/main.mjs'),
      ],
      env: { HOME: home.path, CONTEXT_COMPILER_GRANTEE: 'Context Compiler' },
      stderr: 'pipe',
    });
    let workers: number[] = [];
    // Each worker that is left is killed. One that already stopped gives
    // ESRCH.
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await client.close();
      await transport.close();
      for (const pid of workers)
        try {
          process.kill(pid, 'SIGKILL');
        } catch (error) {
          if (!isErrno(error, 'ESRCH')) throw error;
        }
    });
    await client.connect(transport, { timeout: 120_000 });
    const pid = transport.pid;
    assert.ok(pid);
    // The server starts OCR by itself once its PoolWorkers owns the Vision
    // pool of the computer, a moment after it opens the store: no tool call
    // starts it.
    const ocr = await waitFor(
      async () => {
        const pids = await ocrWorkers(pid);
        assert.ok(
          pids.length >= 1,
          'OCR must be warming up before the first tool call',
        );
        return pids;
      },
      { signal: t.signal, interval: 50 },
    );
    for (const model of ['ggml-small.bin', null]) {
      const changed = await client.callTool({
        name: 'transcription_update',
        arguments: { model },
      });
      assert.equal(changed.isError, undefined);
      const running = await ocrWorkers(pid);
      assert.ok(
        ocr.every((pid) => running.includes(pid)),
        'a settings change must keep the OCR workers',
      );
    }
    workers = (await children(pid)).map(({ pid }) => pid);
    if (shutdown === 'stdin') await client.close();
    else {
      const closed = new Promise<void>((resolve) => {
        client.onclose = resolve;
      });
      process.kill(pid, shutdown);
      await closed;
    }
    if (shutdown === 'stdin')
      await assert.rejects(
        readFile(signals, 'utf8'),
        { code: 'ENOENT' },
        'stdin close must exit before the MCP client resorts to SIGTERM',
      );
    for (const pid of workers)
      assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  });
