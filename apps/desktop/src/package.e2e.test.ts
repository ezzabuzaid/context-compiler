import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { on, once } from 'node:events';
import {
  accessSync,
  constants,
  existsSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { mkdtemp, mkdtempDisposable } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import {
  FuseState,
  FuseV1Options,
  FuseVersion,
  getCurrentFuseWire,
} from '@electron/fuses';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { type Browser, chromium } from 'playwright';

test(
  'the native package is ad-hoc signed, includes its executable server resources and starts without PATH or Codex',
  { timeout: 90_000 },
  async () => {
    const home = await mkdtemp('/tmp/cc-p-');
    const bundle = resolve(
      `apps/desktop/dist/package/Context Compiler-darwin-${process.arch}/Context Compiler.app`,
    );
    const resources = join(bundle, 'Contents/Resources');
    const server = join(resources, 'server');
    const client = new Client({
      name: 'desktop-package-test',
      version: '1.0.0',
    });
    const transport = new StdioClientTransport({
      command: join(bundle, 'Contents/MacOS/Context Compiler'),
      args: [join(server, 'main.mjs')],
      env: {
        HOME: home,
        PATH: '',
        TMPDIR: '/tmp',
        ELECTRON_RUN_AS_NODE: '1',
        CONTEXT_COMPILER_GRANTEE: 'Context Compiler',
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
      assert.ok(existsSync(join(resources, 'app.asar')));
      for (const name of [
        'main.mjs',
        'page.html',
        'version.json',
        'composer-icon.png',
        'chunks',
        'modules',
        'connectors',
        'eventkit-helper',
        'transcribe-local',
      ])
        accessSync(join(server, name), constants.R_OK);
      assert.ok(readdirSync(join(server, 'connectors')).length > 0);
      for (const name of ['eventkit-helper', 'transcribe-local']) {
        accessSync(join(server, name), constants.X_OK);
        const signature = spawnSync(
          '/usr/bin/codesign',
          ['--verify', '--strict', join(server, name)],
          { encoding: 'utf8' },
        );
        assert.equal(signature.status, 0, signature.stderr);
      }
      const verified = spawnSync(
        '/usr/bin/codesign',
        ['--verify', '--deep', '--strict', bundle],
        { encoding: 'utf8' },
      );
      assert.equal(verified.status, 0, verified.stderr);
      const signature = spawnSync(
        '/usr/bin/codesign',
        ['--display', '--verbose=4', bundle],
        { encoding: 'utf8' },
      );
      assert.equal(signature.status, 0, signature.stderr);
      assert.match(signature.stderr, /Signature=adhoc/);
      assert.doesNotMatch(signature.stderr, /Timestamp=/);
      const plist = spawnSync(
        '/usr/bin/plutil',
        ['-convert', 'json', '-o', '-', join(bundle, 'Contents/Info.plist')],
        { encoding: 'utf8' },
      );
      assert.equal(plist.status, 0, plist.stderr);
      const info = JSON.parse(plist.stdout);
      assert.equal(info.CFBundleIdentifier, 'com.ezzabuzaid.context-compiler');
      assert.equal(info.CFBundleDisplayName, 'Context Compiler');
      assert.ok(info.NSCalendarsFullAccessUsageDescription);
      assert.ok(info.NSRemindersFullAccessUsageDescription);
      const fuses = await getCurrentFuseWire(bundle);
      assert.equal(fuses.version, FuseVersion.V1);
      for (const fuse of [
        FuseV1Options.RunAsNode,
        FuseV1Options.EnableCookieEncryption,
        FuseV1Options.EnableEmbeddedAsarIntegrityValidation,
        FuseV1Options.OnlyLoadAppFromAsar,
      ])
        assert.equal(fuses[fuse], FuseState.ENABLE, `Fuse ${fuse}`);
      for (const fuse of [
        FuseV1Options.EnableNodeOptionsEnvironmentVariable,
        FuseV1Options.EnableNodeCliInspectArguments,
        FuseV1Options.GrantFileProtocolExtraPrivileges,
      ])
        assert.equal(fuses[fuse], FuseState.DISABLE, `Fuse ${fuse}`);

      await client.connect(transport);
      const resource = await client.readResource({
        uri: 'ui://context-compiler/page.html',
      });
      assert.ok(
        resource.contents.some(
          (content) =>
            'text' in content &&
            content.text.includes('<title>Context Compiler</title>'),
        ),
        diagnostics,
      );
      const connectors = CallToolResultSchema.parse(
        await client.callTool({
          name: 'connectors',
          arguments: {},
        }),
      );
      assert.notEqual(connectors.isError, true, JSON.stringify(connectors));
      assert.ok(connectors.structuredContent?.connectors instanceof Array);
      const monitors = CallToolResultSchema.parse(
        await client.callTool({
          name: 'monitors',
          arguments: {},
        }),
      );
      assert.equal(monitors.structuredContent?.monitors, null);
      assert.equal(
        existsSync(
          join(
            home,
            'Library/Application Support/Context Compiler/Imports/settings.sqlite',
          ),
        ),
        true,
      );
    } finally {
      try {
        const spawned = transport.pid !== null;
        await client.close();
        if (spawned) await exited.promise;
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    }
  },
);

test(
  'the packaged Vite frontend loads from ASAR and connects to its bundled server',
  { timeout: 60_000 },
  async () => {
    await using home = await mkdtempDisposable('/tmp/cc-packaged-ui-');
    // The signed app disables Node's inspector. Chromium's debugging protocol
    // drives the real renderer without changing any production fuse.
    const child = spawn(
      resolve(
        `apps/desktop/dist/package/Context Compiler-darwin-${process.arch}/Context Compiler.app/Contents/MacOS/Context Compiler`,
      ),
      ['--remote-debugging-port=0'],
      {
        env: { HOME: home.path, PATH: '', TMPDIR: '/tmp' },
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    );
    const exited = once(child, 'exit');
    let browser: Browser | undefined;
    try {
      let diagnostics = '';
      for await (const [chunk] of on(child.stderr, 'data', {
        signal: AbortSignal.timeout(15_000),
      })) {
        diagnostics += String(chunk);
        const endpoint = /(?<=DevTools listening on )ws:\/\/\S+/.exec(
          diagnostics,
        );
        if (endpoint === null) continue;
        browser = await chromium.connectOverCDP(endpoint[0]);
        break;
      }
      assert.ok(browser, diagnostics);
      const context = browser.contexts()[0];
      assert.ok(context);
      context.setDefaultTimeout(10_000);
      const page = context.pages()[0] ?? (await context.waitForEvent('page'));
      await page
        .getByRole('navigation', { name: 'Context Compiler' })
        .waitFor();
      assert.equal(page.url(), 'cc-host://app/index.html');
      await page
        .getByRole('button', { name: 'Audio transcription', exact: true })
        .click();
      await page
        .getByRole('heading', { name: 'Audio transcription', exact: true })
        .waitFor();
      assert.equal((await page.locator('.sidebar').boundingBox())?.width, 275);
      // The real source cannot read CallHistory.storedata in this empty home.
      await page
        .getByRole('switch', { name: 'Call History connected' })
        .click();
      await page
        .locator('.sidebar button.item')
        .filter({ hasText: 'Call History' })
        .click();
      await page
        .getByRole('button', { name: 'Open Full Disk Access' })
        .waitFor();
      const failure = await page.locator('.status').innerText();
      assert.match(failure, /Last sync failed:.*cannot be read/s);
      assert.match(
        failure,
        /Turn on Context Compiler in System Settings › Privacy & Security › Full Disk Access, then quit and reopen Context Compiler\./,
      );
      assert.doesNotMatch(failure, /ChatGPT|Codex|Terminal/);
      const cdp = await browser.newBrowserCDPSession();
      // Electron may exit before acknowledging this protocol command.
      await Promise.race([cdp.send('Browser.close'), exited]);
      const [code] = await exited;
      assert.equal(code, 0);
    } finally {
      await browser?.close();
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
        await exited;
      }
    }
  },
);
