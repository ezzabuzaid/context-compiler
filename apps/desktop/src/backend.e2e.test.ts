import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  constants,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { type FileHandle, mkdtemp, open } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { type ElectronApplication, _electron } from 'playwright';

test(
  'Call History access failures name Context Compiler in the desktop even after ChatGPT configured the import',
  { timeout: 90_000 },
  async () => {
    const home = await mkdtemp('/tmp/cc-permission-');
    let application: ElectronApplication | undefined;
    const client = new Client({ name: 'permission-test', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve('apps/server/dist/server/main.mjs')],
      env: {
        HOME: home,
        PATH: '/usr/bin:/bin',
        CONTEXT_COMPILER_GRANTEE: 'ChatGPT',
      },
      stderr: 'pipe',
    });
    const exited = Promise.withResolvers<void>();
    client.onclose = () => exited.resolve();
    try {
      await client.connect(transport);
      await client.callTool({
        name: 'configure',
        arguments: { connectors: [{ connector: 'call-history' }] },
      });
      // No CallHistory.storedata under this HOME: the real source reports the
      // same unreadable-store failure as macOS denying Full Disk Access.
      await client.callTool({
        name: 'sync',
        arguments: { connector: 'call-history' },
      });
      const before = await client.callTool({
        name: 'connectors',
        arguments: {},
      });
      assert.match(JSON.stringify(before), /Turn on ChatGPT/);

      application = await _electron.launch({
        args: [resolve('apps/desktop')],
        env: {
          HOME: home,
          PATH: process.env.PATH ?? '',
          TMPDIR: '/tmp',
          CONTEXT_COMPILER_GRANTEE: 'ChatGPT',
        },
      });
      const page = await application.firstWindow();
      await page
        .locator('.sidebar button.item')
        .filter({ hasText: 'Call History' })
        .click();
      await page
        .getByRole('button', { name: 'Open Full Disk Access' })
        .waitFor();
      const message = await page.locator('.status').innerText();
      assert.match(message, /Last sync failed:.*cannot be read/s);
      assert.match(
        message,
        /Turn on Context Compiler in System Settings › Privacy & Security › Full Disk Access, then quit and reopen Context Compiler\./,
      );
      assert.doesNotMatch(message, /ChatGPT|Codex|Terminal/);
    } finally {
      try {
        await application?.close();
      } finally {
        const spawned = transport.pid !== null;
        await client.close();
        if (spawned) await exited.promise;
        rmSync(home, { recursive: true, force: true });
      }
    }
  },
);

test(
  'a page sync lasting over 60 seconds succeeds and a plugin launcher joins that import on the same store',
  { timeout: 180_000 },
  async () => {
    const home = await mkdtemp('/tmp/cc-b-');
    let application: ElectronApplication | undefined;
    let writer: FileHandle | undefined;
    const client = new Client({
      name: 'desktop-plugin-concurrency-test',
      version: '1.0.0',
    });
    const transport = new StdioClientTransport({
      command: resolve('plugins/context-compiler/launch_node'),
      args: [resolve('plugins/context-compiler/server/main.mjs')],
      env: {
        HOME: home,
        PATH: '/usr/bin:/bin',
        TMPDIR: '/tmp',
        CODEX_MCP_NODE_PATH: process.execPath,
      },
      stderr: 'pipe',
    });
    let diagnostics = '';
    transport.stderr?.on('data', (chunk: Buffer) => {
      diagnostics += chunk.toString();
    });
    const exited = Promise.withResolvers<void>();
    client.onclose = () => exited.resolve();
    try {
      photos(home);
      application = await _electron.launch({
        args: [resolve('apps/desktop')],
        env: { HOME: home, PATH: process.env.PATH ?? '', TMPDIR: '/tmp' },
      });
      const page = await application.firstWindow();
      await page.getByRole('switch', { name: 'Photos connected' }).click();
      await page
        .getByRole('switch', { name: 'Photos connected', checked: true })
        .waitFor();
      await page
        .locator('.sidebar button.item')
        .filter({ hasText: 'Photos' })
        .locator('.synced')
        .waitFor({ timeout: 30_000 });
      const path = imported(home);
      await client.connect(transport);
      const pipe = join(home, 'Pictures/photos.json');
      rmSync(pipe);
      assert.equal(spawnSync('/usr/bin/mkfifo', [pipe]).status, 0);
      const started = performance.now();
      await page
        .getByRole('button', { name: 'Sync connectors', exact: true })
        .click();
      writer = await readerOf(pipe);
      let joined = false;
      const pluginSync = client
        .callTool(
          { name: 'sync', arguments: { connector: 'photos' } },
          undefined,
          { timeout: 1_800_000 },
        )
        .then(
          (result) => {
            joined = true;
            return { result };
          },
          (error: unknown) => ({ error }),
        );

      // A FIFO keeps the real source inside extraction without replacing any
      // module, server or clock. Crossing 60 s catches the SDK's default timeout.
      await sleep(65_000);
      assert.equal(joined, false, diagnostics);
      assert.equal(
        await page
          .getByRole('button', { name: 'Syncing connectors', exact: true })
          .count(),
        1,
      );
      assert.equal(await page.getByRole('alert').count(), 0);
      await writer.writeFile(
        JSON.stringify([
          { id: 'p1', title: 'Beach' },
          { id: 'p2', title: 'Snow' },
        ]),
      );
      await writer.close();
      writer = undefined;
      const outcome = await pluginSync;
      if ('error' in outcome) throw outcome.error;
      assert.notEqual(
        outcome.result.isError,
        true,
        JSON.stringify(outcome.result),
      );
      await page
        .getByRole('button', { name: 'Sync connectors', exact: true })
        .waitFor({ timeout: 30_000 });
      assert.ok(performance.now() - started > 60_000);
      assert.equal(await page.getByRole('alert').count(), 0);
      using database = new DatabaseSync(path, { readOnly: true });
      assert.deepEqual(
        database
          .prepare('SELECT status FROM sync_attempts ORDER BY attempt_id')
          .all()
          .map((row) => row.status),
        ['succeeded', 'succeeded'],
      );
      assert.deepEqual(
        database
          .prepare('SELECT id FROM photos ORDER BY id')
          .all()
          .map((row) => row.id),
        ['p1', 'p2'],
      );
    } finally {
      try {
        await writer?.close();
      } finally {
        try {
          const spawned = transport.pid !== null;
          await client.close();
          if (spawned) await exited.promise;
        } finally {
          try {
            await application?.close();
          } finally {
            rmSync(home, { recursive: true, force: true });
          }
        }
      }
    }
  },
);

test(
  'cancelling a page tool request reaches the main process and rejects the pending MCP call',
  { timeout: 90_000 },
  async () => {
    const home = await mkdtemp('/tmp/cc-b-');
    let application: ElectronApplication | undefined;
    let writer: FileHandle | undefined;
    try {
      photos(home);
      application = await _electron.launch({
        args: [resolve('apps/desktop')],
        env: { HOME: home, PATH: process.env.PATH ?? '', TMPDIR: '/tmp' },
      });
      const page = await application.firstWindow();
      await page.getByRole('switch', { name: 'Photos connected' }).click();
      await page
        .getByRole('switch', { name: 'Photos connected', checked: true })
        .waitFor();
      await page
        .locator('.sidebar button.item')
        .filter({ hasText: 'Photos' })
        .locator('.synced')
        .waitFor({ timeout: 30_000 });
      const pipe = join(home, 'Pictures/photos.json');
      rmSync(pipe);
      assert.equal(spawnSync('/usr/bin/mkfifo', [pipe]).status, 0);
      const result = page.evaluate(async () => {
        try {
          await window.desktop.callTool(
            'cancelled-sync',
            {
              name: 'sync',
              arguments: { connector: 'photos' },
            },
            1_800_000,
          );
          return 'completed';
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
      });
      writer = await readerOf(pipe);
      await page.evaluate(() => window.desktop.cancelTool('cancelled-sync'));
      const deadline = new AbortController();
      try {
        assert.match(
          await Promise.race([
            result,
            sleep(5000, undefined, { signal: deadline.signal }).then(() => {
              throw new Error('Cancellation did not reject the tool call.');
            }),
          ]),
          /abort|cancel/i,
        );
      } finally {
        deadline.abort();
      }
      await writer.writeFile(JSON.stringify([{ id: 'p1', title: 'Beach' }]));
    } finally {
      try {
        await writer?.close();
      } finally {
        try {
          await application?.close();
        } finally {
          rmSync(home, { recursive: true, force: true });
        }
      }
    }
  },
);

function photos(home: string) {
  const connector = join(
    home,
    'Library/Application Support/Context Compiler/Connectors/photos',
  );
  mkdirSync(connector, { recursive: true });
  writeFileSync(
    join(connector, 'package.json'),
    JSON.stringify({
      type: 'module',
      exports: './photos-connector.ts',
      contextCompiler: { name: 'photos', title: 'Photos' },
    }),
  );
  writeFileSync(
    join(connector, 'photos-connector.ts'),
    readFileSync(
      'packages/connectors/manifest/src/fixtures/photos/photos-connector.ts',
    ),
  );
  mkdirSync(join(home, 'Pictures'));
  writeFileSync(
    join(home, 'Pictures/photos.json'),
    JSON.stringify([{ id: 'p1', title: 'Beach' }]),
  );
}

function imported(home: string): string {
  const store = join(
    home,
    'Library/Application Support/Context Compiler/Imports',
  );
  using settings = new DatabaseSync(join(store, 'settings.sqlite'), {
    readOnly: true,
  });
  const row = settings
    .prepare(
      "SELECT database FROM selected_connectors WHERE connector = 'photos'",
    )
    .get();
  if (typeof row?.database !== 'string')
    throw new Error('Photos has no import.');
  return join(store, row.database);
}

async function readerOf(pipe: string): Promise<FileHandle> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await open(pipe, constants.O_WRONLY | constants.O_NONBLOCK);
    } catch (error) {
      if (!(
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENXIO'
      ))
        throw error;
      if (attempt > 300)
        throw new Error(`Nothing read ${pipe} within 30 seconds.`, {
          cause: error,
        });
      await sleep(100);
    }
  }
}
