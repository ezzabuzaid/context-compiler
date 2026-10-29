import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempDisposable } from 'node:fs/promises';
import { type AddressInfo, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { serve } from '@hono/node-server';
import { HttpServer } from '@zukhruf/testing/http';

import type { Source } from './sources.ts';

// The app keeps its files under XDG_DATA_HOME, read once at import, so the
// tests of this file share one folder; each test reads sites of its own,
// about stories of its own.
await using data = await mkdtempDisposable(join(tmpdir(), 'what-is-going-on-'));
process.env.XDG_DATA_HOME = data.path;
const { default: app } = await import('./app.ts');
const { default: pipeline } = await import('./pipeline.ts');
const { startEmbeddingServer } = await import('./embedding-server.ts');
const { default: reading } = await import('./reading.ts');

const hoursAgo = (hours: number) =>
  new Date(Date.now() - hours * 3_600_000).toISOString();

function article(title: string, published: string, paragraphs: string[]) {
  return `<!doctype html><html><head><title>${title}</title>
<meta property="article:published_time" content="${published}">
</head><body><article><h1>${title}</h1>${paragraphs
    .map((paragraph) => `<p>${paragraph}</p>`)
    .join('')}</article></body></html>`;
}

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

function blog(posts: Record<string, string>) {
  return site({
    '/blog': {
      type: 'text/html',
      body: () =>
        `<!doctype html><html><body><a href="/about">About</a><ul>${Object.keys(
          posts,
        )
          .map((path) => `<li><a href="${path}">${path}</a></li>`)
          .join('')}</ul></body></html>`,
    },
    ...Object.fromEntries(
      Object.entries(posts).map(([path, html]) => [
        path,
        { type: 'text/html', body: () => html },
      ]),
    ),
  });
}

// The port of a server that listens on TCP.
function listening(address: string | AddressInfo | null) {
  assert.ok(address !== null && typeof address === 'object');
  return address;
}

async function freePort() {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = listening(server.address());
  server.close();
  await once(server, 'close');
  return port;
}

const labBlog = (name: string, origin: string): Source => ({
  name,
  kind: 'lab',
  site: `${origin}/blog`,
  feed: null,
  posts: `${origin}/blog`,
});

const outletFeed = (name: string, origin: string): Source => ({
  name,
  kind: 'outlet',
  site: `${origin}/`,
  feed: `${origin}/feed.xml`,
  posts: `${origin}/`,
});

function feed(
  items: { title: string; path: string; hours: number }[],
  name = 'Feed',
) {
  return {
    type: 'application/rss+xml',
    body: (origin: string) =>
      `<?xml version="1.0"?><rss version="2.0"><channel><title>${name}</title><link>${origin}/</link>${items
        .map(
          ({ title, path, hours }) =>
            `<item><title>${title}</title><link>${origin}${path}</link><pubDate>${new Date(Date.now() - hours * 3_600_000).toUTCString()}</pubDate></item>`,
        )
        .join('')}</channel></rss>`,
  };
}

// Runs one pass of the pipeline over the sources with a real embedding server.
async function crawl(sources: readonly Source[]) {
  await using embeddings = await startEmbeddingServer(await freePort());
  await (await pipeline({ sources, embeddings: embeddings.url })).run();
}

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

// Clicks the button labelled label on the line that shows title, as a
// browser submits its form.
async function click(
  origin: string,
  html: string,
  title: string,
  label: string,
) {
  const line = html
    .split('<li>')
    .find((item) => item.includes(`>${title}</a>`));
  assert.ok(line, `no line shows ${title}`);
  const form = line
    .split('</form>')
    .find((part) => part.includes(`>${label}</button>`));
  const action = form?.match(/action="([^"]+)"/)?.[1];
  assert.ok(form && action, `no ${label} on the line of ${title}`);
  const fields = [...form.matchAll(/name="([^"]+)" value="([^"]*)"/g)].map(
    ([, name, value]) => [name ?? '', (value ?? '').replaceAll('&amp;', '&')],
  );
  await fetch(`${origin}${action}`, {
    method: 'POST',
    body: new URLSearchParams(fields),
    redirect: 'manual',
  });
}

async function addInterest(origin: string, name: string, keywords: string) {
  await fetch(`${origin}/interests`, {
    method: 'POST',
    body: new URLSearchParams({ name, sentence: `About ${name}`, keywords }),
    redirect: 'manual',
  });
}

await test('a crawl of a lab blog makes its posts appear among the events no interest matches', async () => {
  await using lab = await blog({
    '/blog/quill-notes': article(
      'Quill Lab opens its notebook archive',
      hoursAgo(3),
      [
        'Quill Lab opened an archive of 4,000 research notebooks to the public on Tuesday.',
        'The notebooks cover twelve years of experiments in optics and lasers.',
        'Researchers can search the archive by date, instrument and author.',
      ],
    ),
    '/blog/quill-hiring': article(
      'Quill Lab starts a fellowship for glassblowers',
      hoursAgo(5),
      [
        'Quill Lab started a two-year fellowship for scientific glassblowers.',
        'Six fellows will build custom vacuum chambers for the optics group.',
        'Applications close at the end of the year.',
      ],
    ),
  });
  await crawl([labBlog('Quill Lab', lab.origin)]);
  await using reader = await serveApp();

  const unmatched = await page(`${reader.origin}/not-matched`);

  assert.match(
    unmatched,
    /Quill Lab opens its notebook archive<\/a> \[Quill Lab\] \[3h\]/,
  );
  assert.match(
    unmatched,
    /Quill Lab starts a fellowship for glassblowers<\/a> \[Quill Lab\] \[5h\]/,
  );
  assert.doesNotMatch(unmatched, /About/);
});

await test('a lab post whose page carries no date shows the date its feed gives', async () => {
  await using lab = await site({
    '/feed.xml': feed([
      {
        title: 'Moss Lab maps river sediment',
        path: '/posts/sediment',
        hours: 50,
      },
    ]),
    '/posts/sediment': {
      type: 'text/html',
      body: () =>
        `<!doctype html><html><head><title>Moss Lab maps river sediment</title></head><body><article><h1>Moss Lab maps river sediment</h1><p>Moss Lab mapped the sediment of 300 rivers with a fleet of 40 drones.</p><p>The map shows where dams trap the most silt.</p><p>The survey data is open to researchers.</p></article></body></html>`,
    },
  });
  await crawl([
    {
      name: 'Moss Lab',
      kind: 'lab',
      site: `${lab.origin}/`,
      feed: `${lab.origin}/feed.xml`,
      posts: `${lab.origin}/`,
    },
  ]);
  await using reader = await serveApp();

  const unmatched = await page(`${reader.origin}/not-matched`);

  assert.match(
    unmatched,
    /Moss Lab maps river sediment<\/a> \[Moss Lab\] \[2d\]/,
  );
});

await test("an outlet's report of a lab's announcement folds under the lab's line as [+1], and the event page lists both", async () => {
  await using lab = await blog({
    '/blog/atlas-7': article(
      'Atlas Labs releases Atlas-7, a 70-billion-parameter model',
      hoursAgo(4),
      [
        'Atlas Labs released Atlas-7, a language model with 70 billion parameters and a context window of 256,000 tokens.',
        'Atlas-7 scores 81.4 percent on the GPQA science benchmark, up from 74.2 percent for Atlas-6.',
        'The model is available today through the Atlas API at $2 per million input tokens.',
      ],
    ),
  });
  await using outlet = await site({
    '/feed.xml': feed([
      {
        title: 'Atlas Labs launches Atlas-7',
        path: '/news/atlas-7-launch',
        hours: 2,
      },
    ]),
    '/news/atlas-7-launch': {
      type: 'text/html',
      body: () =>
        article(
          'Atlas Labs launches Atlas-7 with 70 billion parameters',
          hoursAgo(2),
          [
            'Atlas Labs on Tuesday launched Atlas-7, a 70-billion-parameter language model with a 256,000-token context window.',
            'The company says Atlas-7 reaches 81.4 percent on the GPQA benchmark, against 74.2 percent for Atlas-6.',
            'Atlas-7 costs $2 per million input tokens through the Atlas API.',
          ],
        ),
    },
  });
  await crawl([
    labBlog('Atlas Labs', lab.origin),
    outletFeed('Daily Wire', outlet.origin),
  ]);
  await using reader = await serveApp();

  const unmatched = await page(`${reader.origin}/not-matched`);
  const event = unmatched.match(
    /Atlas Labs releases Atlas-7, a 70-billion-parameter model<\/a> \[Atlas Labs\] \[4h\] <a href="(\/event\/\d+)">\[\+1\]<\/a>/,
  );
  assert.ok(event?.[1], unmatched);
  const reports = await page(`${reader.origin}${event[1]}`);

  assert.doesNotMatch(
    unmatched,
    /Atlas Labs launches Atlas-7 with 70 billion parameters<\/a>/,
  );
  assert.match(reports, /2 reports from 2 publishers/);
  assert.match(
    reports,
    /Atlas Labs releases Atlas-7, a 70-billion-parameter model<\/a> \[Atlas Labs\] \[4h\]<\/li><li><a [^>]+>Atlas Labs launches Atlas-7 with 70 billion parameters<\/a> \[Daily Wire\] \[2h\]/,
  );
});

await test('Today shows a column per interest with only the events whose lab report matches it', async () => {
  await using lab = await blog({
    '/blog/yeast': article(
      'Fern Lab maps every protein in a yeast cell',
      hoursAgo(3),
      [
        'Fern Lab published a map of 6,000 proteins inside a living yeast cell.',
        'The map shows which proteins touch during cell division.',
        'Biologists can browse the protein map online.',
      ],
    ),
    '/blog/chip': article(
      'Fern Lab tapes out its first inference chip',
      hoursAgo(4),
      [
        'Fern Lab finished the design of its first inference chip, built on a 3-nanometre process.',
        'The chip draws 40 watts and serves small models in data centres.',
        'Samples ship to partners in the spring.',
      ],
    ),
  });
  await crawl([labBlog('Fern Lab', lab.origin)]);
  await using reader = await serveApp();
  await addInterest(reader.origin, 'Biology', 'protein, cell biology');

  const today = await page(`${reader.origin}/`);

  assert.match(
    today,
    /<h3><a class="source" href="\/interest\/Biology">Biology<\/a><\/h3>/,
  );
  assert.match(today, /Fern Lab maps every protein in a yeast cell<\/a>/);
  assert.doesNotMatch(today, /Fern Lab tapes out its first inference chip/);
});

await test("[x] on an interest's page removes the event from that interest's page", async () => {
  await using lab = await blog({
    '/blog/reef': article(
      'Coral Lab sends ocean robots to map a reef',
      hoursAgo(3),
      [
        'Coral Lab sent 30 ocean robots to map the coral reef off the coast of Belize.',
        'The robots dive to 40 metres and photograph each coral colony.',
        'The map will be published next year.',
      ],
    ),
  });
  await crawl([labBlog('Coral Lab', lab.origin)]);
  await using reader = await serveApp();
  await addInterest(reader.origin, 'Oceans', 'ocean');
  const before = await page(`${reader.origin}/interest/Oceans`);

  await click(
    reader.origin,
    before,
    'Coral Lab sends ocean robots to map a reef',
    '[x]',
  );
  const after = await page(`${reader.origin}/interest/Oceans`);

  assert.match(before, /Coral Lab sends ocean robots to map a reef<\/a>/);
  assert.doesNotMatch(after, /Coral Lab sends ocean robots to map a reef/);
});

await test('Not matched lists the events that no interest shows, and the menu counts them', async () => {
  await using lab = await blog({
    '/blog/rail': article(
      'Birch Lab plans a railway timetable with a solver',
      hoursAgo(3),
      [
        'Birch Lab built a solver that plans the railway timetable of a whole country.',
        'The solver plans 9,000 trains a day in under a minute.',
        'Two railway operators test it this winter.',
      ],
    ),
    '/blog/choir': article(
      'Birch Lab records a choir for its speech dataset',
      hoursAgo(4),
      [
        'Birch Lab recorded a choir of 80 singers for an open speech dataset.',
        'The recordings hold 120 hours of song in five languages.',
        'The dataset is free for research use.',
      ],
    ),
  });
  await crawl([labBlog('Birch Lab', lab.origin)]);
  await using reader = await serveApp();
  await addInterest(reader.origin, 'Transport', 'railway');

  const unmatched = await page(`${reader.origin}/not-matched`);

  const count = Number(unmatched.match(/Not matched \((\d+)\)/)?.[1]);
  const lines = (unmatched.split('</ul>')[0]?.split('<li>').length ?? 1) - 1;
  assert.equal(count, lines);
  assert.match(
    unmatched,
    /Birch Lab records a choir for its speech dataset<\/a>/,
  );
  assert.doesNotMatch(
    unmatched,
    /Birch Lab plans a railway timetable with a solver/,
  );
});

await test('a followed event shows the reports that joined it after the follow as [N new], and Following lists them', async () => {
  await using lab = await blog({
    '/blog/kite': article(
      'Kite Labs flies a solar drone for 40 days',
      hoursAgo(6),
      [
        'Kite Labs flew its Helio-2 solar drone for 40 days without landing, a record for its class.',
        'Helio-2 has a 25-metre wing and carries a 12-kilogram camera payload.',
        'The flight ended over the Mojave desert on Monday.',
      ],
    ),
  });
  await using outlet = await site({
    '/feed.xml': feed([
      {
        title: 'Solar drone Helio-2 stays aloft 40 days',
        path: '/news/helio-2',
        hours: 1,
      },
    ]),
    '/news/helio-2': {
      type: 'text/html',
      body: () =>
        article(
          'Kite Labs solar drone Helio-2 stays aloft for 40 days',
          hoursAgo(1),
          [
            'Kite Labs said its Helio-2 solar drone stayed in the air for 40 days, a record for drones of its class.',
            'The drone has a 25-metre wing and a 12-kilogram camera payload.',
            'Helio-2 landed over the Mojave desert on Monday.',
          ],
        ),
    },
  });
  await crawl([labBlog('Kite Labs', lab.origin)]);
  await using reader = await serveApp();
  await click(
    reader.origin,
    await page(`${reader.origin}/not-matched`),
    'Kite Labs flies a solar drone for 40 days',
    '[follow]',
  );

  await crawl([
    labBlog('Kite Labs', lab.origin),
    outletFeed('Sky Wire', outlet.origin),
  ]);
  const unmatched = await page(`${reader.origin}/not-matched`);
  const following = await page(`${reader.origin}/following`);

  assert.match(
    unmatched,
    /Kite Labs flies a solar drone for 40 days<\/a> \[Kite Labs\] \[6h\] <a href="\/event\/\d+">\[\+1\]<\/a> <a href="\/event\/\d+"><b>\[1 new\]<\/b><\/a> <form[^>]+unfollow/,
  );
  assert.match(following, /Following \(1\)/);
  assert.match(
    following,
    /Kite Labs flies a solar drone for 40 days<\/a><\/h3><p>\[Kite Labs\] followed \[0m\]/,
  );
  assert.match(
    following,
    /<li><a [^>]+>Kite Labs solar drone Helio-2 stays aloft for 40 days<\/a> \[Sky Wire\] \[1h\]<\/li>/,
  );
});

async function addSite(origin: string, url: string, kind: 'lab' | 'outlet') {
  return fetch(`${origin}/sources`, {
    method: 'POST',
    body: new URLSearchParams({ url, kind }),
    redirect: 'manual',
  });
}

// The app's reader watching its sources, as main.ts runs it: a site added
// on Sources is read while it runs.
async function watchSources() {
  const embeddings = await startEmbeddingServer(await freePort());
  reading.start({ sources: [], embeddings: embeddings.url });
  return {
    [Symbol.asyncDispose]: async () => {
      await reading.stop();
      await embeddings[Symbol.asyncDispose]();
    },
  };
}

// The page once it shows text, or as it is after a minute.
async function whenShown(url: string, text: string) {
  const deadline = Date.now() + 60_000;
  let body = await page(url);
  while (!body.includes(text) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    body = await page(url);
  }
  return body;
}

await test('a blog page added on Sources is read by the running reader through the posts it links to', async () => {
  await using lab = await blog({
    '/blog/loom': article(
      'Loom Lab weaves a sensor into cotton thread',
      hoursAgo(3),
      [
        'Loom Lab wove a strain sensor into ordinary cotton thread.',
        'A shirt made of the thread measures breathing at 50 readings a second.',
        'The thread survives 200 washes.',
      ],
    ),
  });
  await using reader = await serveApp();
  await using _watch = await watchSources();

  await addSite(reader.origin, `${lab.origin}/blog`, 'lab');
  const unmatched = await whenShown(
    `${reader.origin}/not-matched`,
    'Loom Lab weaves a sensor into cotton thread',
  );
  const sources = await page(`${reader.origin}/sources`);

  assert.match(
    unmatched,
    /Loom Lab weaves a sensor into cotton thread<\/a> \[[^\]]+\] \[3h\]/,
  );
  assert.match(
    sources,
    new RegExp(
      `<a href="${RegExp.escape(`${lab.origin}/blog`)}">[^<]+</a> \\[blog page re-read \\(no feed\\)\\]`,
    ),
  );
});

await test('a page added on Sources that advertises a feed is read through that feed', async () => {
  await using lab = await site({
    '/': {
      type: 'text/html',
      body: (origin) =>
        `<!doctype html><html><head><title>Pine Lab</title><link rel="alternate" type="application/rss+xml" href="${origin}/feed.xml"></head><body><p>Pine Lab news.</p></body></html>`,
    },
    '/feed.xml': feed(
      [
        {
          title: 'Pine Lab grows a forest model',
          path: '/posts/forest',
          hours: 2,
        },
      ],
      'Pine Lab',
    ),
    '/posts/forest': {
      type: 'text/html',
      body: () =>
        article('Pine Lab grows a forest model', hoursAgo(2), [
          'Pine Lab trained a model that predicts the growth of 2,000 tree species.',
          'The model uses 40 years of forest surveys.',
          'Foresters can try it online.',
        ]),
    },
  });
  await using reader = await serveApp();
  await using _watch = await watchSources();

  await addSite(reader.origin, `${lab.origin}/`, 'lab');
  const unmatched = await whenShown(
    `${reader.origin}/not-matched`,
    'Pine Lab grows a forest model',
  );
  const sources = await page(`${reader.origin}/sources`);

  assert.match(unmatched, /Pine Lab grows a forest model<\/a> \[Pine Lab\]/);
  assert.match(
    sources,
    new RegExp(
      `\\[<a href="${RegExp.escape(`${lab.origin}/feed.xml`)}">feed</a>\\]`,
    ),
  );
});

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
