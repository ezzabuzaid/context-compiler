import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempDisposable } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
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
const { default: reading } = await import('./reading.ts');

const hoursAgo = (hours: number) =>
  new Date(Date.now() - hours * 3_600_000).toISOString();

function article(
  title: string,
  published: string | null,
  paragraphs: string[],
) {
  return `<!doctype html><html><head><title>${title}</title>${
    published === null
      ? ''
      : `<meta property="article:published_time" content="${published}">`
  }</head><body><article><h1>${title}</h1>${paragraphs
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

const labBlog = (name: string, origin: string): Source => ({
  name,
  kind: 'lab',
  site: `${origin}/blog`,
  feed: null,
  posts: `${origin}/blog/*`,
});

const outletFeed = (name: string, origin: string): Source => ({
  name,
  kind: 'outlet',
  site: `${origin}/`,
  feed: `${origin}/feed.xml`,
  posts: `${origin}/*`,
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

// Runs one pass of the pipeline over the sources, embedding through Llama.app.
async function crawl(sources: readonly Source[]) {
  await (await pipeline({ sources })).run();
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

// Adds an interest through the form; disposing it deletes it through
// [delete], so the next test starts without it.
async function addInterest(origin: string, name: string, sentence = '') {
  await fetch(`${origin}/interests`, {
    method: 'POST',
    body: new URLSearchParams({ name, sentence }),
    redirect: 'manual',
  });
  return {
    [Symbol.asyncDispose]: async () => {
      await fetch(`${origin}/interest/${encodeURIComponent(name)}/delete`, {
        method: 'POST',
        redirect: 'manual',
      });
    },
  };
}

// Twenty posts of one lab, each about a different thing, so each is an event
// of its own and the decision model answers twenty lines.
function twentyPosts(lab: string) {
  const posts = [
    [
      'otters',
      'counts the otters back in its river',
      'Otters returned to the river after 40 years.',
    ],
    [
      'basalt',
      'stores carbon dioxide in basalt rock',
      'The gas turned to stone within two years.',
    ],
    [
      'violin',
      'scans a 300-year-old violin with X-rays',
      'The scan shows three repairs inside the body.',
    ],
    [
      'bread',
      'bakes bread with a wheat that needs less water',
      'The loaves rose as well as ordinary ones.',
    ],
    [
      'tram',
      'tests a tram that charges at every stop',
      'The tram ran 40 kilometres a day for a month.',
    ],
    [
      'coral',
      'grows coral on a frame of recycled glass',
      'Divers counted 900 young corals on the frame.',
    ],
    [
      'chess',
      'trains a chess program on old club games',
      'The program won 70 of 100 games against club players.',
    ],
    [
      'honey',
      'traces fake honey by its sugar pattern',
      'One jar in five from the market was not pure honey.',
    ],
    [
      'bridge',
      'listens to the cracks inside a steel bridge',
      'Microphones found two cracks that inspectors missed.',
    ],
    [
      'owls',
      'tags barn owls with tiny radio tags',
      'One owl flew 30 kilometres in a night.',
    ],
    [
      'paint',
      'makes a white paint that cools a roof',
      'The roof stayed 8 degrees cooler in July.',
    ],
    [
      'vaccine',
      'freeze-dries a vaccine for hot regions',
      'The dried vaccine kept for six months without a fridge.',
    ],
    [
      'language',
      'records the last speakers of a mountain language',
      'The archive holds 200 hours of speech.',
    ],
    [
      'solar',
      'prints solar cells on thin plastic sheets',
      'The sheets made 18 percent of the power of glass cells.',
    ],
    [
      'sleep',
      'measures sleep with a ring on the finger',
      'The ring matched a sleep clinic on 9 nights of 10.',
    ],
    [
      'wheat',
      'finds a gene that lets wheat resist rust',
      'Plants with the gene lost no leaves to the fungus.',
    ],
    [
      'meteor',
      'films meteors with 50 cameras on rooftops',
      'The cameras tracked 1,200 meteors in one night.',
    ],
    [
      'textile',
      'turns old jeans into new thread',
      'The new thread was 80 percent as strong.',
    ],
    [
      'volcano',
      'flies a drone into the plume of a volcano',
      'The drone measured the gas for 20 minutes.',
    ],
    [
      'ferment',
      'ferments cabbage with a new strain of bacteria',
      'The cabbage was ready in four days instead of ten.',
    ],
  ];
  return Object.fromEntries(
    posts.map(([slug, did, result], index) => [
      `/blog/${lab.toLowerCase()}-${slug}`,
      article(`${lab} Lab ${did}`, hoursAgo(2 + index / 10), [
        `${lab} Lab reported its work on ${slug} this week.`,
        `${result}`,
        'The lab will publish the full data next year.',
      ]),
    ]),
  );
}

// How many answers of the decision model the app keeps for a sentence, about
// the reports whose text holds about. No page shows them: the app keeps them
// in decisions.sqlite so that a page asks the model once (#3430), so a test
// of that reads the file.
function answers(sentence: string, about = '') {
  using database = new DatabaseSync(
    join(data.path, 'what-is-going-on', 'decisions.sqlite'),
    { readOnly: true, timeout: 5_000 },
  );
  return Number(
    database
      .prepare(
        'SELECT count(*) AS n FROM decision WHERE instr(question, ?) > 0 AND instr(state, ?) > 0',
      )
      .get(sentence, about)?.n,
  );
}

// Waits, polling from a timer, until the app keeps at least one answer for a
// sentence, or fails after a minute.
async function whenAnswered(sentence: string) {
  const deadline = Date.now() + 60_000;
  while (answers(sentence) === 0) {
    assert.ok(Date.now() < deadline, `no answer for ${sentence}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
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

  const unmatched = await page(`${reader.origin}/not-matched?limit=50`);

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
      posts: `${lab.origin}/*`,
    },
  ]);
  await using reader = await serveApp();

  const unmatched = await page(`${reader.origin}/not-matched?limit=50`);

  assert.match(
    unmatched,
    /Moss Lab maps river sediment<\/a> \[Moss Lab\] \[2d\]/,
  );
});

await test('a page that shows its date only as text under its title takes that date', async () => {
  const shown = new Date(Date.now() - 10 * 86_400_000).toLocaleDateString(
    'en-US',
    { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' },
  );
  await using lab = await blog({
    '/blog/reed-sensors': `<!doctype html><html><head><title>Reed Lab builds a moisture sensor from reeds</title></head><body><article><h1>Reed Lab builds a moisture sensor from reeds</h1><p>${shown}</p><p>Reed Lab built a soil moisture sensor from dried river reeds and copper wire.</p><p>Each sensor costs 30 cents and lasts two growing seasons.</p><p>Farmers in 12 villages are testing the first 500 sensors.</p></article></body></html>`,
  });
  await crawl([labBlog('Reed Lab', lab.origin)]);
  await using reader = await serveApp();

  const unmatched = await page(
    `${reader.origin}/not-matched?hours=720&limit=50`,
  );

  assert.match(
    unmatched,
    /Reed Lab builds a moisture sensor from reeds<\/a> \[Reed Lab\] \[1[01]d\]/,
  );
});

await test('a page that declares a publish date in the future shows [no date], not a fresh age', async () => {
  await using lab = await blog({
    '/blog/kiln-schedule': article(
      'Kiln Lab schedules its open day',
      hoursAgo(-14),
      [
        'Kiln Lab will open its furnace hall to visitors for one day in November.',
        'Engineers will show the 1,400-degree kiln that fires its ceramic membranes.',
        'Places are free and limited to 200 visitors.',
      ],
    ),
  });
  await crawl([labBlog('Kiln Lab', lab.origin)]);
  await using reader = await serveApp();

  const unmatched = await page(`${reader.origin}/not-matched?limit=50`);

  assert.match(
    unmatched,
    /Kiln Lab schedules its open day<\/a> \[Kiln Lab\] \[no date\]/,
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

  const unmatched = await page(`${reader.origin}/not-matched?limit=50`);
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

await test("Today shows a column per interest with the interest's best line first", async () => {
  await using lab = await blog({
    '/blog/yeast': article(
      'Fern Lab maps every protein in a yeast cell',
      hoursAgo(20),
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
  await using _interest = await addInterest(
    reader.origin,
    'Biology',
    'Biology research: proteins, cells and how living things work.',
  );

  const today = await page(`${reader.origin}/`);

  assert.match(
    today,
    /<h3><a class="source" href="\/interest\/Biology">Biology<\/a><\/h3>/,
  );
  assert.match(
    today,
    /href="\/interest\/Biology">Biology<\/a><\/h3><ul><li><a href="[^"]+">Fern Lab maps every protein in a yeast cell<\/a>/,
  );
});

await test('an interest added without a sentence ranks by its name', async () => {
  await using lab = await blog({
    '/blog/kelp': article('Kelp Lab farms seaweed for jet fuel', hoursAgo(3), [
      'Kelp Lab grew 40 tonnes of seaweed off the coast and turned it into jet fuel.',
      'The fuel passed the first engine tests at a test site in Norway.',
      'Kelp Lab plans a farm ten times larger next year.',
    ]),
    '/blog/kelp-ledger': article(
      'Kelp Lab moves its accounts to a new ledger system',
      hoursAgo(2),
      [
        'Kelp Lab moved its accounts to a new ledger system this month.',
        'The finance team closed the quarter two days faster.',
        'The old system is switched off in December.',
      ],
    ),
  });
  await crawl([labBlog('Kelp Lab', lab.origin)]);
  await using reader = await serveApp();
  await using _interest = await addInterest(reader.origin, 'Seaweed');

  const today = await page(`${reader.origin}/`);

  assert.match(
    today,
    /<h3><a class="source" href="\/interest\/Seaweed">Seaweed<\/a><\/h3><ul><li><a href="[^"]+">Kelp Lab farms seaweed for jet fuel<\/a>/,
  );
});

await test("an interest's sentence ranks the post about it first", async () => {
  await using lab = await blog({
    '/blog/lark-satellite': article(
      'Lark Lab sends a weather satellite to orbit on a small rocket',
      hoursAgo(22),
      [
        'Lark Lab launched a 40-kilogram weather satellite into a 550-kilometre orbit on Tuesday.',
        'The rocket lifted off from a coastal pad and released the satellite after nine minutes.',
        'The satellite will measure clouds and sea temperature for three years.',
      ],
    ),
    '/blog/lark-garden': article(
      'Lark Lab plants a garden of herbs on its roof',
      hoursAgo(21),
      [
        'Lark Lab planted 40 kinds of herb in a garden on the roof of its office.',
        'Staff pick the herbs for the canteen kitchen.',
        'The garden needs no water in the wet months.',
      ],
    ),
  });
  await crawl([labBlog('Lark Lab', lab.origin)]);
  await using reader = await serveApp();
  await using _interest = await addInterest(
    reader.origin,
    'Spaceflight',
    'Rocket launches and satellites that go into orbit',
  );

  const interest = await page(`${reader.origin}/interest/Spaceflight`);

  assert.match(
    interest,
    /<h3>Spaceflight<\/h3><p>[^<]*<\/p><ul><li><a href="[^"]+">Lark Lab sends a weather satellite to orbit on a small rocket<\/a>/,
  );
});

await test('an interest added again with a new sentence ranks by the new sentence, not by the answers for the old one', async () => {
  await using lab = await blog({
    '/blog/fjord-glacier': article(
      'Fjord Lab measures how fast a glacier melts into the sea',
      hoursAgo(5),
      [
        'Fjord Lab put 30 sensors on a glacier where it meets the sea.',
        'The ice front lost 12 metres a day through the summer.',
        'The lab will measure the glacier again in the winter.',
      ],
    ),
    '/blog/fjord-beetles': article(
      'Fjord Lab counts the beetles that live in old pine trees',
      hoursAgo(6),
      [
        'Fjord Lab counted 41 kinds of beetle in the bark of old pine trees.',
        'Three of the kinds were not known in the region before.',
        'The beetles live only in trees older than 150 years.',
      ],
    ),
  });
  await crawl([labBlog('Fjord Lab', lab.origin)]);
  await using reader = await serveApp();
  let before: string;
  {
    await using _first = await addInterest(
      reader.origin,
      'Fieldwork',
      'Glaciers, sea ice and how fast they melt',
    );
    before = await page(`${reader.origin}/interest/Fieldwork`);
  }

  await using _again = await addInterest(
    reader.origin,
    'Fieldwork',
    'Beetles and the other insects that live in forests',
  );
  const after = await page(`${reader.origin}/interest/Fieldwork`);

  assert.match(
    before,
    /<h3>Fieldwork<\/h3><p>[^<]*<\/p><ul><li><a href="[^"]+">Fjord Lab measures how fast a glacier melts into the sea<\/a>/,
  );
  assert.match(
    after,
    /<h3>Fieldwork<\/h3><p>[^<]*<\/p><ul><li><a href="[^"]+">Fjord Lab counts the beetles that live in old pine trees<\/a>/,
  );
});

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
  await using _interest = await addInterest(
    reader.origin,
    'Oceans',
    'The oceans and the life in them.',
  );
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

await test("Not matched lists the lines that no interest's column shows, and the menu counts them", async () => {
  // Six lines, one more than the column's limit, published in the last hour,
  // so they are the newest lines and Not matched lists them first.
  await using lab = await blog({
    '/blog/rail': article(
      'Birch Lab plans a railway timetable with a solver',
      hoursAgo(0.2),
      [
        'Birch Lab built a solver that plans the railway timetable of a whole country.',
        'The solver plans 9,000 trains a day in under a minute.',
        'Two railway operators test it this winter.',
      ],
    ),
    '/blog/choir': article(
      'Birch Lab records a choir for its speech dataset',
      hoursAgo(0.3),
      [
        'Birch Lab recorded a choir of 80 singers for an open speech dataset.',
        'The recordings hold 120 hours of song in five languages.',
        'The dataset is free for research use.',
      ],
    ),
    '/blog/moths': article(
      'Birch Lab counts the moths that fly to street lamps',
      hoursAgo(0.4),
      [
        'Birch Lab counted 3,000 moths at 40 street lamps over one summer.',
        'Warm white lamps drew half as many moths as cold white ones.',
        'The city will test warm lamps in two parks.',
      ],
    ),
    '/blog/clay': article(
      'Birch Lab fires pottery in a kiln heated by the sun',
      hoursAgo(0.5),
      [
        'Birch Lab fired 60 clay pots in a kiln that mirrors heat with sunlight.',
        'The kiln reached 1,100 degrees at noon.',
        'Potters in two villages will try it next spring.',
      ],
    ),
    '/blog/chess': article(
      'Birch Lab teaches chess to children with a board that talks',
      hoursAgo(0.6),
      [
        'Birch Lab built a chess board that explains each move out loud.',
        'Children who used it for a month won twice as many games.',
        'The board costs less than a school calculator.',
      ],
    ),
    '/blog/salt': article(
      'Birch Lab grows rice in salty soil near the coast',
      hoursAgo(0.7),
      [
        'Birch Lab grew rice in fields that the sea had flooded with salt.',
        'The new strain gave 80 percent of the usual harvest.',
        'Farmers on three islands will plant it next season.',
      ],
    ),
  });
  await crawl([labBlog('Birch Lab', lab.origin)]);
  await using reader = await serveApp();
  await using _interest = await addInterest(
    reader.origin,
    'Transport',
    'Railways, roads and how people and goods travel.',
  );

  const shown = await page(`${reader.origin}/interest/Transport?limit=5`);
  const unmatched = await page(`${reader.origin}/not-matched?limit=5`);

  const titles = (html: string) =>
    new Set(
      [
        ...(html.split('<main')[1] ?? '').matchAll(
          /<li><a href="[^"]+">([^<]+)<\/a>/g,
        ),
      ].map(([, title]) => title),
    );
  const count = Number(unmatched.match(/Not matched \((\d+)\)/)?.[1]);
  assert.equal(titles(unmatched).size, Math.min(count, 5));
  assert.ok(
    titles(shown).has('Birch Lab plans a railway timetable with a solver'),
  );
  assert.deepEqual(
    [...titles(unmatched)].filter((title) => titles(shown).has(title)),
    [],
  );
  assert.ok(
    titles(shown).has('Birch Lab records a choir for its speech dataset') ||
      titles(unmatched).has('Birch Lab records a choir for its speech dataset'),
  );
  // Each of the lab's lines is in the column or in Not matched, and in one
  // of them only.
  const birch = [...titles(shown), ...titles(unmatched)].filter(
    (title) => title !== undefined && title.startsWith('Birch Lab '),
  );
  assert.equal(birch.length, 6);
  assert.equal(new Set(birch).size, 6);
});

await test('reports that arrive are answered for every interest, so a page shows them again without asking the decision model', async () => {
  await using lab = await blog(twentyPosts('Ash'));
  await using reader = await serveApp();
  await using _first = await addInterest(
    reader.origin,
    'Materials',
    'New materials and how they are made',
  );
  await using _second = await addInterest(
    reader.origin,
    'Wildlife',
    'Wild animals and how they live',
  );

  await crawl([labBlog('Ash Lab', lab.origin)]);
  const stored = [
    answers('New materials and how they are made', 'Ash Lab'),
    answers('Wild animals and how they live', 'Ash Lab'),
  ];
  await page(`${reader.origin}/interest/Materials`);
  const viewed = answers('New materials and how they are made', 'Ash Lab');
  const started = performance.now();
  await page(`${reader.origin}/interest/Materials`);
  const again = performance.now() - started;

  assert.deepEqual(stored, [20, 20]);
  // A page that did not find the stored answers would ask about the twenty
  // reports again, under its own text.
  assert.equal(viewed, 20);
  // Asked again, the lines of the window would take seconds: d1 answers in
  // about 0.3 s each.
  assert.ok(again < 1_500, `the page took ${Math.round(again)} ms again`);
});

await test('stopping the reader while the decision model answers for new reports ends in seconds, before most answers', async () => {
  await using lab = await blog(twentyPosts('Elm'));
  await using reader = await serveApp();
  await using _interest = await addInterest(
    reader.origin,
    'Harvest',
    'Farming, food and the crops people grow',
  );
  reading.start({ sources: [labBlog('Elm Lab', lab.origin)] });
  // A failure before the stop below still stops the reader.
  await using _watch = { [Symbol.asyncDispose]: () => reading.stop() };
  await whenAnswered('Farming, food and the crops people grow');

  const started = performance.now();
  await reading.stop();
  const took = performance.now() - started;

  assert.ok(took < 3_000, `the stop took ${Math.round(took)} ms`);
  assert.ok(answers('Farming, food and the crops people grow') < 20);
});

// The views that ask the decision model about the lines of the window, each
// with a lab and a sentence of its own, so its answers start cold.
for (const view of [
  {
    name: 'Show matches',
    lab: 'Oak',
    sentence: 'The sky, the weather and what falls from space',
    path: (sentence: string) =>
      `/interests?${new URLSearchParams({ name: 'Sky', sentence })}`,
    saved: false,
  },
  {
    name: "an interest's page",
    lab: 'Yew',
    sentence: 'Music, instruments and the people who play them',
    path: () => '/interest/Sky',
    saved: true,
  },
  {
    name: 'Today',
    lab: 'Fir',
    sentence: 'Medicine, vaccines and how illness is treated',
    path: () => '/',
    saved: true,
  },
])
  await test(`${view.name} that its viewer leaves stops asking the decision model`, async () => {
    await using lab = await blog(twentyPosts(view.lab));
    await crawl([labBlog(`${view.lab} Lab`, lab.origin)]);
    await using reader = await serveApp();
    await using _interest = view.saved
      ? await addInterest(reader.origin, 'Sky', view.sentence)
      : undefined;
    const leave = new AbortController();
    const asked = performance.now();
    const viewed = fetch(`${reader.origin}${view.path(view.sentence)}`, {
      signal: leave.signal,
    }).catch(() => undefined);
    await whenAnswered(view.sentence);
    // A view that kept asking would store more answers in a few times the
    // time of the first one, however fast the decision model is today.
    const wait = Math.max(2_000, 3 * (performance.now() - asked));

    leave.abort();
    await viewed;
    await new Promise((resolve) => setTimeout(resolve, 200));
    const left = answers(view.sentence);
    await new Promise((resolve) => setTimeout(resolve, wait));

    assert.equal(answers(view.sentence), left);
    assert.ok(left < 20);
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
    await page(`${reader.origin}/not-matched?limit=50`),
    'Kite Labs flies a solar drone for 40 days',
    '[follow]',
  );

  await crawl([
    labBlog('Kite Labs', lab.origin),
    outletFeed('Sky Wire', outlet.origin),
  ]);
  const unmatched = await page(`${reader.origin}/not-matched?limit=50`);
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

// A page that links to the given paths, as a blog's index does.
const index = (paths: string[]) => ({
  type: 'text/html',
  body: () =>
    `<!doctype html><html><body><ul>${paths
      .map((path) => `<li><a href="${path}">${path}</a></li>`)
      .join('')}</ul></body></html>`,
});

const post = (html: string) => ({ type: 'text/html', body: () => html });

await test('a report without a date shows [no date] after the dated ones, and Sources shows the age of the newest dated report', async () => {
  await using lab = await blog({
    '/blog/clay-dated': article(
      'Clay Lab fires a ceramic battery',
      hoursAgo(30),
      [
        'Clay Lab fired a ceramic battery that stores 40 watt-hours per kilogram.',
        'The battery survives 900 degrees.',
        'Kilns could use it as a heat store.',
      ],
    ),
    '/blog/clay-undated': article(
      'Clay Lab opens a pottery school for engineers',
      null,
      [
        'Clay Lab opened a pottery school where engineers learn to throw clay.',
        'Classes run on weekends for twelve weeks.',
        'The first class has 24 students.',
      ],
    ),
  });
  await crawl([labBlog('Clay Lab', lab.origin)]);
  await using reader = await serveApp();

  const unmatched = await page(`${reader.origin}/not-matched?limit=50`);
  const sources = await page(`${reader.origin}/sources`);

  assert.match(
    unmatched,
    /Clay Lab fires a ceramic battery<\/a> \[Clay Lab\] \[1d\][^]*Clay Lab opens a pottery school for engineers<\/a> \[Clay Lab\] \[no date\]/,
  );
  assert.match(sources, />Clay Lab<\/a> \[page\] \[1d\]<\/li>/);
});

await test('a lab read through two blog pages shows once on Sources, with both pages', async () => {
  await using lab = await site({
    '/news': index(['/news/cedar-wins']),
    '/research': index(['/research/cedar-roots']),
    '/news/cedar-wins': post(
      article('Cedar Lab wins a grant for drought maps', hoursAgo(5), [
        'Cedar Lab won a grant of 3 million euros to map drought in southern Europe.',
        'The maps will update every week.',
        'Farmers can read them for free.',
      ]),
    ),
    '/research/cedar-roots': post(
      article('Cedar Lab measures how deep olive roots grow', hoursAgo(6), [
        'Cedar Lab measured olive roots that reach 6 metres below the surface.',
        'Deep roots let the trees survive four dry months.',
        'The study covers 300 trees.',
      ]),
    ),
  });
  const page_ = (path: string): Source => ({
    name: 'Cedar Lab',
    kind: 'lab',
    site: `${lab.origin}${path}`,
    feed: null,
    posts: `${lab.origin}${path}/*`,
  });
  await crawl([page_('/news'), page_('/research')]);
  await using reader = await serveApp();

  const sources = await page(`${reader.origin}/sources`);

  assert.equal(sources.split('>Cedar Lab</a>').length - 1, 1);
  assert.match(
    sources,
    />Cedar Lab<\/a> \[page: <a href="[^"]+\/news">news<\/a>, <a href="[^"]+\/research">research<\/a>\] \[5h\]/,
  );
});

await test('a page that a lab blog links to outside its posts pattern is not read as a post', async () => {
  await using lab = await site({
    '/research': index(['/research/team/economics', '/research/oak-rings']),
    '/research/team/economics': post(
      article('Oak Lab economics team', hoursAgo(2), [
        'The economics team of Oak Lab studies how markets use timber.',
        'It has eight members.',
        'It publishes a report each year.',
      ]),
    ),
    '/research/oak-rings': post(
      article('Oak Lab dates a beam by its tree rings', hoursAgo(3), [
        'Oak Lab dated an oak beam from a church roof to the year 1183 by its tree rings.',
        'The beam holds 212 rings.',
        'The church is older than its records say.',
      ]),
    ),
  });
  await crawl([
    {
      name: 'Oak Lab',
      kind: 'lab',
      site: `${lab.origin}/research`,
      feed: null,
      posts: `${lab.origin}/research/:slug`,
    },
  ]);
  await using reader = await serveApp();

  const unmatched = await page(`${reader.origin}/not-matched?limit=50`);

  assert.match(unmatched, /Oak Lab dates a beam by its tree rings<\/a>/);
  assert.doesNotMatch(unmatched, /Oak Lab economics team/);
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
  reading.start({ sources: [] });
  return {
    [Symbol.asyncDispose]: async () => {
      await reading.stop();
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
    `${reader.origin}/not-matched?limit=50`,
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
      `<a href="${RegExp.escape(`${lab.origin}/blog`)}">[^<]+</a> \\[page\\]`,
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
    `${reader.origin}/not-matched?limit=50`,
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
