import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtempDisposable, readdir, writeFile } from 'node:fs/promises';
import { availableParallelism, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function children(parent: number) {
  const { stdout } = await promisify(execFile)('/bin/ps', [
    '-axo',
    'pid=,ppid=',
  ]);
  return stdout
    .trim()
    .split('\n')
    .flatMap((line) => {
      const [pid, ppid] = line.trim().split(/\s+/).map(Number);
      return ppid === parent ? [pid!] : [];
    });
}

for (const shutdown of ['stdin', 'SIGTERM'] as const)
  test(`the MCP server starts OCR before any tool call, reuses it across settings changes and stops it on ${shutdown}`, async () => {
    await using home = await mkdtempDisposable(join(tmpdir(), 'server-ocr-'));
    const temporary = new Set(await readdir(tmpdir()));
    const model = join(
      home.path,
      '.cache/huggingface/hub/models--ggerganov--whisper.cpp/snapshots/a1',
    );
    await mkdir(model, { recursive: true });
    await writeFile(join(model, 'ggml-small.bin'), 'lmgg');
    const client = new Client({ name: 'ocr-test', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve('plugins/context-compiler/server/main.mjs')],
      env: { HOME: home.path, CONTEXT_COMPILER_GRANTEE: 'Context Compiler' },
      stderr: 'pipe',
    });
    let workers: number[] = [];
    try {
      await client.connect(transport, { timeout: 120_000 });
      assert.ok(transport.pid);
      workers = await children(transport.pid);
      assert.ok(
        workers.length >= 1 && workers.length <= availableParallelism(),
        'a device-sized OCR pool must already be running before the first tool call',
      );
      for (const model of ['ggml-small.bin', null]) {
        const changed = await client.callTool({
          name: 'transcription_update',
          arguments: { model },
        });
        assert.equal(changed.isError, undefined);
        assert.deepEqual(await children(transport.pid), workers);
      }
      const started = performance.now();
      if (shutdown === 'stdin') await client.close();
      else {
        const closed = new Promise<void>((resolve) => {
          client.onclose = resolve;
        });
        process.kill(transport.pid, shutdown);
        await closed;
      }
      assert.ok(
        performance.now() - started < 2_000,
        'stdin close must exit before the MCP client resorts to SIGTERM',
      );
      for (const pid of workers)
        assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
      assert.deepEqual(
        (await readdir(tmpdir())).filter(
          (name) => name.startsWith('vision-warmup-') && !temporary.has(name),
        ),
        [],
        'OCR leaves no temporary files on shutdown',
      );
    } finally {
      await client.close();
      await transport.close();
      for (const pid of workers) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          /* Already stopped. */
        }
      }
    }
  });
