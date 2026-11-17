import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { TemporaryFiles } from '@zukhruf/fs';

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
  test(`the MCP server starts OCR before any tool call, reuses it across settings changes and stops it on ${shutdown}`, async () => {
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
    try {
      await client.connect(transport, { timeout: 120_000 });
      assert.ok(transport.pid);
      const ocr = await ocrWorkers(transport.pid);
      assert.ok(
        ocr.length >= 1,
        'OCR must already be warming up before the first tool call',
      );
      for (const model of ['ggml-small.bin', null]) {
        const changed = await client.callTool({
          name: 'transcription_update',
          arguments: { model },
        });
        assert.equal(changed.isError, undefined);
        const running = await ocrWorkers(transport.pid);
        assert.ok(
          ocr.every((pid) => running.includes(pid)),
          'a settings change must keep the OCR workers',
        );
      }
      workers = (await children(transport.pid)).map(({ pid }) => pid);
      if (shutdown === 'stdin') await client.close();
      else {
        const closed = new Promise<void>((resolve) => {
          client.onclose = resolve;
        });
        process.kill(transport.pid, shutdown);
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
