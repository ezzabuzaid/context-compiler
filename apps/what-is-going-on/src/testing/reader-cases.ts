import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import { serve } from '@hono/node-server';
import { HttpServer } from '@zukhruf/testing/http';

// The app keeps its files under XDG_DATA_HOME, read once at import, so the
// tests of this file share one folder, which reader.test.ts gives this
// process.
if (process.env.XDG_DATA_HOME === undefined)
  assert.fail(
    'Run these tests through reader.test.ts, which gives them their own XDG_DATA_HOME.',
  );
const { default: app } = await import('../app.ts');

// A web site: each path answers its page, every other path 404, and there is
// no robots.txt.
function site(
  pages: Record<string, { type: string; body: (origin: string) => string }>,
) {
  const server = new HttpServer();
  return server.start((request, response) => {
    const page = pages[request.url ?? ''];
    if (page === undefined) response.writeHead(404).end();
    else
      response
        .writeHead(200, { 'content-type': page.type })
        .end(page.body(`http://${request.headers.host}`));
  });
}

// The port of a server that listens on TCP.
function listening(address: string | AddressInfo | null) {
  assert.ok(address !== null && typeof address === 'object');
  return address;
}

// The app's server, as main.ts serves it.
async function serveApp() {
  const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' });
  await once(server, 'listening');
  const { port } = listening(server.address());
  return {
    origin: `http://127.0.0.1:${port}`,
    [Symbol.asyncDispose]: async () => {
      server.close();
      await once(server, 'close');
    },
  };
}

const page = async (url: string) => (await fetch(url)).text();

await test('a form the app cannot accept answers with a page that names the problem, not JSON', async () => {
  await using reader = await serveApp();

  const response = await fetch(`${reader.origin}/interests`, {
    method: 'POST',
    body: new URLSearchParams({ name: ' ', sentence: '' }),
    redirect: 'manual',
  });
  const body = await response.text();

  assert.equal(response.status, 400);
  assert.match(response.headers.get('content-type') ?? '', /text\/html/);
  assert.match(body, /What is going on/);
  assert.match(body, /Name is empty\./);
  assert.doesNotMatch(body, /"code"/);
});

async function addSite(origin: string, url: string, kind: 'lab' | 'outlet') {
  return fetch(`${origin}/sources`, {
    method: 'POST',
    body: new URLSearchParams({ url, kind }),
    redirect: 'manual',
  });
}

await test('an address that answers 404 is not added, and Sources says so', async () => {
  await using gone = await site({});
  await using reader = await serveApp();

  const answer = await addSite(reader.origin, `${gone.origin}/blog`, 'lab');
  const body = await answer.text();
  const sources = await page(`${reader.origin}/sources`);

  assert.equal(answer.status, 422);
  assert.match(
    body,
    new RegExp(`${RegExp.escape(`${gone.origin}/blog`)} answered 404\\.`),
  );
  assert.doesNotMatch(sources, new RegExp(RegExp.escape(gone.origin)));
});
