import assert from 'node:assert/strict';
import { cp, mkdir, mkdtempDisposable, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test(
  'the bundled MCP page connects through AppBridge, imports Photos, follows deep links and preserves selection across theme changes',
  { timeout: 60_000 },
  async () => {
    await using home = await mkdtempDisposable('/tmp/cc-page-');
    const connector = join(
      home.path,
      'Library/Application Support/Context Compiler/Connectors/photos',
    );
    await mkdir(connector, { recursive: true });
    await cp(
      'packages/connectors/manifest/src/fixtures/photos/photos-connector.ts',
      join(connector, 'photos-connector.ts'),
    );
    await writeFile(
      join(connector, 'package.json'),
      JSON.stringify({
        type: 'module',
        exports: './photos-connector.ts',
        contextCompiler: { name: 'photos', title: 'Photos' },
      }),
    );
    await mkdir(join(home.path, 'Pictures'));
    await writeFile(
      join(home.path, 'Pictures/photos.json'),
      JSON.stringify([{ id: 'p1', title: 'Beach' }]),
    );
    const client = new Client({ name: 'page-test', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve('apps/server/dist/server/main.mjs')],
      env: { HOME: home.path, CONTEXT_COMPILER_GRANTEE: 'Context Compiler' },
      stderr: 'pipe',
    });
    const browser = await chromium.launch({ channel: 'chrome' });
    try {
      await client.connect(transport);
      const resource = await client.readResource({
        uri: 'ui://context-compiler/page.html',
      });
      const content = resource.contents[0];
      assert.ok(content && 'text' in content);
      const host = await browser.newPage();
      await host.setContent(
        '<!doctype html><html><body><iframe title="Context Compiler" sandbox="allow-scripts allow-forms" style="width:100%;height:900px"></iframe></body></html>',
      );
      await host.exposeFunction('callServerTool', (input: unknown) => {
        const { params } = CallToolRequestSchema.parse({
          method: 'tools/call',
          params: input,
        });
        return client.callTool(params);
      });
      const { outputFiles } = await build({
        stdin: {
          contents: `import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';
import { OPENAI_DEEP_LINK_KEY } from '@openai/mcp-extensions/app';
const frame = document.querySelector('iframe');
const bridge = new AppBridge(null, { name: 'page-test', version: '1.0.0' }, { serverTools: {} }, {
  hostContext: { theme: 'light', [OPENAI_DEEP_LINK_KEY]: { url: '/connectors/photos' } },
});
bridge.oncalltool = params => window.callServerTool(params);
window.addEventListener('test:context', event => bridge.setHostContext({ theme: event.detail.theme, [OPENAI_DEEP_LINK_KEY]: { url: event.detail.url } }));
await bridge.connect(new PostMessageTransport(frame.contentWindow, frame.contentWindow));`,
          resolveDir: process.cwd(),
        },
        bundle: true,
        write: false,
        format: 'esm',
        platform: 'browser',
      });
      assert.ok(outputFiles[0]);
      await host.addScriptTag({ type: 'module', content: outputFiles[0].text });
      await host
        .locator('iframe')
        .evaluate((frame: HTMLIFrameElement, html) => {
          frame.srcdoc = html;
        }, content.text);
      const page = host.frameLocator('iframe');
      await page
        .getByRole('heading', { name: 'Photos', exact: true })
        .waitFor();
      await page.getByRole('switch', { name: 'Photos connected' }).click();
      await page
        .getByRole('switch', { name: 'Photos connected', checked: true })
        .waitFor();
      await page.locator('.sidebar .synced').waitFor();
      for (const theme of ['dark', 'light']) {
        await host.evaluate(
          (theme) =>
            window.dispatchEvent(
              new CustomEvent('test:context', {
                detail: { theme, url: '/connectors/photos' },
              }),
            ),
          theme,
        );
        await page.locator(`html[data-theme="${theme}"]`).waitFor();
        assert.equal(
          await page
            .getByRole('heading', { name: 'Photos', exact: true })
            .count(),
          1,
        );
      }
      await host.evaluate(() =>
        window.dispatchEvent(
          new CustomEvent('test:context', {
            detail: { theme: 'light', url: '/transcription' },
          }),
        ),
      );
      await page
        .getByRole('heading', { name: 'Audio transcription', exact: true })
        .waitFor();
      assert.equal((await page.locator('.sidebar').boundingBox())?.width, 275);
      // The resource remains self-contained after extracting the shared package.
      assert.doesNotMatch(content.text, /<script[^>]+src=/);
    } finally {
      try {
        await browser.close();
      } finally {
        await client.close();
        await transport.close();
      }
    }
  },
);
