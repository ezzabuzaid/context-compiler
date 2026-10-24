import assert from 'node:assert/strict';
import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { type ElectronApplication, _electron } from 'playwright';

test(
  'the Apple page connects Photos, syncs the real store, hides Monitors, reopens and quits its backend',
  { timeout: 120_000 },
  async () => {
    const home = await mkdtemp('/tmp/cc-d-');
    let application: ElectronApplication | undefined;
    let second: ChildProcess | undefined;
    try {
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
          'utf8',
        ) +
          `\nimport { writeFileSync } from 'node:fs';
writeFileSync(join(homedir(), 'backend.json'), JSON.stringify({ pid: process.pid, env: process.env }));\n`,
      );
      mkdirSync(join(home, 'Pictures'));
      writeFileSync(
        join(home, 'Pictures/photos.json'),
        JSON.stringify([{ id: 'p1', title: 'Beach' }]),
      );
      application = await _electron.launch({
        args: [resolve('apps/desktop')],
        env: {
          HOME: home,
          PATH: process.env.PATH ?? '',
          TMPDIR: '/tmp',
          CODEX_CLI_PATH: '/does/not/exist',
          CONTEXT_COMPILER_PAGE_URI: 'codex://unwanted',
          CONTEXT_COMPILER_CHAT_URI: 'codex://unwanted',
        },
      });
      const page = await application.firstWindow();
      await page.getByRole('switch', { name: 'Photos connected' }).waitFor();
      assert.equal(await page.title(), 'Context Compiler');
      second = spawn(
        application.process().spawnfile,
        [resolve('apps/desktop')],
        {
          env: { HOME: home, PATH: process.env.PATH ?? '', TMPDIR: '/tmp' },
          stdio: 'ignore',
        },
      );
      const [exitCode] = await once(second, 'exit', {
        signal: AbortSignal.timeout(15_000),
      });
      assert.equal(exitCode, 0);
      second = undefined;
      assert.equal(application.windows().length, 1);
      assert.equal(
        await page.getByText('Monitors', { exact: true }).count(),
        0,
      );
      await page.getByRole('switch', { name: 'Photos connected' }).click();
      await page
        .getByRole('switch', { name: 'Photos connected', checked: true })
        .waitFor();
      const photos = page
        .locator('.sidebar button.item')
        .filter({ hasText: 'Photos' });
      await photos.click();
      await photos.locator('.synced').waitFor({ timeout: 30_000 });
      const store = join(
        home,
        'Library/Application Support/Context Compiler/Imports',
      );
      const database = imported(store);
      assert.deepEqual(rows(database), [{ id: 'p1', title: 'Beach' }]);

      writeFileSync(
        join(home, 'Pictures/photos.json'),
        JSON.stringify([
          { id: 'p1', title: 'Beach' },
          { id: 'p2', title: 'Snow' },
        ]),
      );
      await page
        .getByRole('button', { name: 'Sync connectors', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Sync connectors', exact: true })
        .waitFor({ timeout: 30_000 });
      assert.deepEqual(rows(database), [
        { id: 'p1', title: 'Beach' },
        { id: 'p2', title: 'Snow' },
      ]);
      const watching = page.getByRole('switch', { name: 'Keep current' });
      await watching.click();
      await photos.getByText('Watching', { exact: true }).waitFor();
      await watching.click();
      await photos
        .getByText('Watching', { exact: true })
        .waitFor({ state: 'hidden' });
      const attachments = page.getByRole('checkbox', {
        name: 'Copy attachments',
      });
      const copied = await attachments.isChecked();
      await attachments.setChecked(!copied);
      await page.getByRole('button', { name: 'Discard', exact: true }).click();
      assert.equal(await attachments.isChecked(), copied);
      await attachments.setChecked(!copied);
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.getByRole('dialog').waitFor();
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      assert.deepEqual(rows(database), [
        { id: 'p1', title: 'Beach' },
        { id: 'p2', title: 'Snow' },
      ]);
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page
        .getByRole('button', { name: 'Import again', exact: true })
        .click();
      // Saving disables both buttons. Once the server confirms the selection,
      // Save stays disabled (nothing changed) and Discard is enabled again.
      await page
        .locator('form')
        .filter({
          has: page.getByRole('button', {
            name: 'Save',
            exact: true,
            disabled: true,
          }),
        })
        .getByRole('button', { name: 'Discard', exact: true, disabled: false })
        .waitFor();
      await photos.locator('.synced').waitFor({ timeout: 30_000 });
      assert.deepEqual(rows(imported(store)), [
        { id: 'p1', title: 'Beach' },
        { id: 'p2', title: 'Snow' },
      ]);
      await page
        .getByRole('button', { name: 'Audio transcription', exact: true })
        .click();
      await page
        .getByRole('heading', { name: 'Audio transcription', exact: true })
        .waitFor();
      await page
        .getByText('No speech model is installed on this Mac.', {
          exact: false,
        })
        .waitFor();
      assert.equal(
        await page
          .getByRole('switch', { name: 'Transcribe audio' })
          .isDisabled(),
        true,
      );
      assert.equal(
        await page
          .getByRole('button', { name: 'Save', exact: true })
          .isDisabled(),
        true,
      );
      assert.equal((await page.locator('.sidebar').boundingBox())?.width, 275);
      for (const theme of ['light', 'dark'] as const) {
        await application.evaluate(({ nativeTheme }, theme) => {
          nativeTheme.themeSource = theme;
        }, theme);
        await page.locator(`html[data-theme="${theme}"]`).waitFor();
        assert.equal(
          await page
            .locator('body')
            .evaluate((body) => getComputedStyle(body).backgroundColor),
          theme === 'dark' ? 'rgb(30, 30, 30)' : 'rgb(255, 255, 255)',
        );
      }
      const backend = JSON.parse(
        readFileSync(join(home, 'backend.json'), 'utf8'),
      );
      assert.equal(backend.env.ELECTRON_RUN_AS_NODE, '1');
      assert.equal(backend.env.CONTEXT_COMPILER_GRANTEE, 'Context Compiler');
      for (const key of [
        'CODEX_CLI_PATH',
        'CONTEXT_COMPILER_PAGE_URI',
        'CONTEXT_COMPILER_CHAT_URI',
      ])
        assert.equal(backend.env[key], undefined);

      await page.close();
      assert.equal(application.process().exitCode, null);
      await application.evaluate(({ app }) => {
        app.emit('activate');
      });
      const reopened = await application.firstWindow();
      await reopened
        .getByRole('switch', { name: 'Photos connected' })
        .waitFor();
      process.kill(backend.pid, 'SIGKILL');
      await reopened
        .getByRole('button', { name: 'Retry', exact: true })
        .waitFor();
      assert.match(
        await reopened.getByRole('alert').innerText(),
        /backend exited/i,
      );
      await reopened
        .getByRole('button', { name: 'Retry', exact: true })
        .click();
      await reopened
        .getByRole('switch', { name: 'Photos connected' })
        .waitFor();
      const restarted = JSON.parse(
        readFileSync(join(home, 'backend.json'), 'utf8'),
      );
      assert.notEqual(restarted.pid, backend.pid);
      const closed = application.waitForEvent('close');
      await application.evaluate(({ app }) => {
        app.quit();
      });
      await closed;
      assert.throws(() => process.kill(restarted.pid, 0), { code: 'ESRCH' });
      application = undefined;
    } finally {
      try {
        if (
          second !== undefined &&
          second.exitCode === null &&
          second.signalCode === null
        ) {
          const exited = once(second, 'exit');
          second.kill('SIGKILL');
          await exited;
        }
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

test(
  'a backend that cannot start shows its failure and Retry opens the page after the cause is removed',
  { timeout: 90_000 },
  async () => {
    const home = await mkdtemp('/tmp/cc-f-');
    let application: ElectronApplication | undefined;
    try {
      const root = join(home, 'Library/Application Support/Context Compiler');
      mkdirSync(root, { recursive: true });
      writeFileSync(
        join(root, 'Imports'),
        'A file cannot be an import directory.',
      );
      application = await _electron.launch({
        args: [resolve('apps/desktop')],
        env: { HOME: home, PATH: process.env.PATH ?? '', TMPDIR: '/tmp' },
      });
      const hostWindow = await application.firstWindow();
      await hostWindow
        .getByRole('button', { name: 'Retry', exact: true })
        .waitFor();
      assert.match(
        await hostWindow.getByRole('alert').innerText(),
        /EEXIST|ENOTDIR|directory/i,
      );
      rmSync(join(root, 'Imports'));
      await hostWindow
        .getByRole('button', { name: 'Retry', exact: true })
        .click();
      await hostWindow
        .getByRole('navigation', { name: 'Context Compiler' })
        .waitFor();
    } finally {
      try {
        await application?.close();
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    }
  },
);

function imported(store: string): string {
  using settings = new DatabaseSync(join(store, 'settings.sqlite'), {
    readOnly: true,
    timeout: 5_000,
  });
  const row = settings
    .prepare(
      "SELECT database FROM selected_connectors WHERE connector = 'photos'",
    )
    .get();
  assert.ok(typeof row?.database === 'string', 'Photos has no import.');
  return join(store, row.database);
}

function rows(path: string) {
  using database = new DatabaseSync(path, { readOnly: true });
  return database
    .prepare('SELECT id, title FROM photos ORDER BY id')
    .all()
    .map((row) => ({ ...row }));
}
