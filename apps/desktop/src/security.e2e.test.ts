import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';

import { type ElectronApplication, _electron } from 'playwright';

test(
  'the renderer is isolated and the main process rejects tools outside the page contract',
  { timeout: 90_000 },
  async () => {
    const home = await mkdtemp('/tmp/cc-s-');
    let application: ElectronApplication | undefined;
    try {
      application = await _electron.launch({
        args: [resolve('apps/desktop')],
        env: { HOME: home, PATH: process.env.PATH ?? '', TMPDIR: '/tmp' },
      });
      const page = await application.firstWindow();
      await page
        .getByRole('navigation', { name: 'Context Compiler' })
        .waitFor();
      assert.deepEqual(
        await page.evaluate(() => ({
          node: typeof Reflect.get(window, 'process'),
          require: typeof Reflect.get(window, 'require'),
          ipc: typeof Reflect.get(window, 'ipcRenderer'),
          resource: typeof Reflect.get(window.desktop, 'readResource'),
        })),
        {
          node: 'undefined',
          require: 'undefined',
          ipc: 'undefined',
          resource: 'undefined',
        },
      );
      assert.deepEqual(
        await page.evaluate(() => Object.keys(window.desktop).sort()),
        ['callTool', 'cancelTool', 'onState', 'retry', 'state'],
      );
      for (const name of [
        'setup',
        'context',
        'configure',
        'monitor_add',
        'monitor_remove',
        'hooks',
      ]) {
        await assert.rejects(
          () =>
            page.evaluate(async (name) => {
              await Reflect.apply(window.desktop.callTool, window.desktop, [
                crypto.randomUUID(),
                { name, arguments: {} },
                60_000,
              ]);
            }, name),
          /not available/,
        );
      }
      for (const timeout of [0, -1, Infinity, 1_800_001]) {
        await assert.rejects(
          () =>
            page.evaluate(async (timeout) => {
              await window.desktop.callTool(
                crypto.randomUUID(),
                { name: 'connectors' },
                timeout,
              );
            }, timeout),
          /Invalid tool timeout/,
        );
      }
      assert.equal(
        await application.evaluate(async ({ net }) => {
          const response = await net.fetch(
            'cc-host://app/%2e%2e%2fhost/main.mjs',
          );
          return response.status;
        }),
        404,
      );
    } finally {
      try {
        await application?.close();
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    }
  },
);

test(
  'the renderer denies network, injected scripts, eval, frames, popups, navigation and browser permissions',
  { timeout: 90_000 },
  async () => {
    const home = await mkdtemp('/tmp/cc-s-');
    let application: ElectronApplication | undefined;
    try {
      application = await _electron.launch({
        args: [resolve('apps/desktop')],
        env: { HOME: home, PATH: process.env.PATH ?? '', TMPDIR: '/tmp' },
      });
      const page = await application.firstWindow();
      const remoteResponses: string[] = [];
      page.on('response', (response) => {
        if (new URL(response.url()).hostname === 'example.invalid')
          remoteResponses.push(response.url());
      });
      const response = await page.reload();
      assert.ok(response);
      const policy = response.headers()['content-security-policy'];
      assert.ok(policy);
      assert.match(policy, /script-src 'self'/);
      assert.match(policy, /connect-src 'none'/);
      assert.match(policy, /object-src 'none'/);
      assert.match(policy, /frame-src 'none'/);
      assert.doesNotMatch(policy, /unsafe-eval/);
      await page
        .getByRole('navigation', { name: 'Context Compiler' })
        .waitFor();
      assert.equal(
        await page.evaluate(async () => {
          return new Promise<string>((resolve, reject) => {
            const timer = setTimeout(
              () => reject(new Error('No CSP violation')),
              5000,
            );
            document.addEventListener('securitypolicyviolation', (event) => {
              if (event.violatedDirective !== 'connect-src') return;
              clearTimeout(timer);
              resolve(event.violatedDirective);
            });
            void fetch('https://example.invalid/probe').catch(() => undefined);
          });
        }),
        'connect-src',
      );
      assert.equal(
        await page.evaluate(() => {
          const script = document.createElement('script');
          script.textContent = "document.body.dataset.injected = 'yes'";
          document.body.append(script);
          return document.body.dataset.injected;
        }),
        undefined,
      );
      assert.equal(
        await page.evaluate(
          () =>
            new Promise<string>((done) => {
              // A page task avoids DevTools' CSP exemption during evaluate().
              setTimeout(() => {
                try {
                  done(
                    String(
                      Reflect.apply(globalThis.eval, undefined, ['1 + 1']),
                    ),
                  );
                } catch {
                  done('blocked');
                }
              }, 0);
            }),
        ),
        'blocked',
      );
      assert.equal(
        await page.evaluate(
          () =>
            new Promise<string>((resolve, reject) => {
              const timer = setTimeout(
                () => reject(new Error('No frame CSP violation')),
                5000,
              );
              document.addEventListener('securitypolicyviolation', (event) => {
                if (event.violatedDirective !== 'frame-src') return;
                clearTimeout(timer);
                resolve(event.violatedDirective);
              });
              const frame = document.createElement('iframe');
              frame.src = 'cc-host://app/index.html';
              document.body.append(frame);
            }),
        ),
        'frame-src',
      );
      assert.equal(
        await page.evaluate(
          () => window.open('https://example.invalid') === null,
        ),
        true,
      );
      assert.equal(
        await page.evaluate(
          async () =>
            (await navigator.permissions.query({ name: 'geolocation' })).state,
        ),
        'denied',
      );
      await page.evaluate(() => {
        const link = document.createElement('a');
        link.href = 'https://example.invalid/navigation';
        document.body.append(link);
        link.click();
        window.location.href = 'https://example.invalid/top';
      });
      // A deliberately cancelled navigation leaves Playwright's locator
      // navigation waiter pending; inspect the still-live document directly.
      assert.equal(
        await page.evaluate(() =>
          document.querySelector('nav')?.getAttribute('aria-label'),
        ),
        'Context Compiler',
      );
      assert.equal(page.url(), 'cc-host://app/index.html');
      assert.equal(application.windows().length, 1);
      assert.deepEqual(remoteResponses, []);
    } finally {
      try {
        await application?.close();
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    }
  },
);
