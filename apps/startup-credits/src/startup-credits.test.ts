import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempDisposable, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';

const avinash = 'https://github.com/avinash201199/awesome-startup-credits';
const doanbactam = 'https://github.com/doanbactam/awesome-builder-programs';

type Page = { readonly status: number; readonly body: string };
const ok = (body: string): Page => ({ status: 200, body });

// A GitHub list as github.com renders it, trimmed from
// github.com/doanbactam/awesome-builder-programs on 2026-10-30: GitHub's own
// links in its header and file list, and the README table that links each
// program's own page.
const githubList = (
  path: string,
  rows: readonly (readonly [string, string, string])[],
) =>
  ok(`<!doctype html><html><head><title>GitHub - ${path}</title></head><body>
<header><a href="/">GitHub</a><a href="/login?return_to=${encodeURIComponent(path)}">Sign in</a></header>
<main><div role="grid"><a href="${path}/blob/main/LICENSE">LICENSE</a></div>
<article class="markdown-body entry-content container-lg" itemprop="text"><table>
<thead><tr><th>Program</th><th>Provider</th><th>Benefit</th></tr></thead><tbody>
${rows.map(([href, provider, benefit]) => `<tr><td><a href="${href}" rel="nofollow">${provider}</a></td><td>${provider}</td><td>${benefit}</td></tr>`).join('\n')}
</tbody></table></article></main></body></html>`);

// The two lists the app reads, with the given rows in the first.
const lists = (rows: readonly (readonly [string, string, string])[]) => ({
  [avinash]: githubList('/avinash201199/awesome-startup-credits', rows),
  [doanbactam]: githubList('/doanbactam/awesome-builder-programs', []),
});

// aws.amazon.com/startups/credits, trimmed on 2026-10-30, with its
// non-breaking spaces.
const awsProgram = (amount: string) =>
  ok(`<!doctype html><html><head><title>AWS Activate Credits – Up to $200K for Eligible Startups</title></head><body>
<nav><a href="/">AWS</a></nav><main><h1>AWS Activate Credits</h1>
<p>Move from prototype to production faster. Apply for up to&nbsp;${amount} in AWS Activate Credits, with additional credits available for AI startups ready to scale.&nbsp;</p>
<p>Up to $5,000&nbsp;USD in Activate Credits&nbsp;</p></main></body></html>`);

// microsoft.com/en-us/startups, trimmed on 2026-10-30.
const microsoftProgram =
  ok(`<!doctype html><html><head><title>Microsoft for Startups | Microsoft</title></head><body>
<main><h1>Microsoft for Startups</h1><p>Access cutting-edge AI models, developer tools, and <b>up to $150,000 in credits</b>, backed by Microsoft’s global customer network.</p></main></body></html>`);

// cloud.google.com/startup, trimmed on 2026-10-30: a tier's dollar figure in
// a sentence that names no credits.
const googleProgram =
  ok(`<!doctype html><html><head><title>Google for Startups Cloud Program</title></head><body>
<main><h1>Google for Startups Cloud Program</h1><p>Up to $350,000 in Cloud credits over two years.</p>
<ul><li>Start ($2k) tier is designed for startups founded in the past 2 years, with a working MVP, a clear business model, and plans to seek venture funding soon.</li></ul></main></body></html>`);

// www.anthropic.com, trimmed on 2026-10-30: a home page that names no
// program.
const anthropicHome =
  ok(`<!doctype html><html><head><title>Home \\ Anthropic</title></head><body>
<main><h1>AI research and products that put safety at the frontier.</h1>
<p>Anthropic is a Public Benefit Corporation (PBC), a designation that requires us to balance the financial interests of shareholders with the benefit to the broader public.</p></main></body></html>`);

// openai.com/startups/ as it answers a crawler: a Cloudflare challenge.
const cloudflareChallenge: Page = {
  status: 403,
  body: '<!doctype html><html><head><title>Just a moment...</title></head><body></body></html>',
};

// The internet as the app's process sees it in a test, loaded before
// main.ts: GitHub and the companies' websites answer these pages, every
// robots.txt is missing, any other request fails, and each request is
// written to stderr. The clock runs ahead by the given milliseconds, since a
// test cannot wait a month for the pages to be due again.
const internet = (pages: Readonly<Record<string, Page>>, ahead: number) => `
import { setupServer } from ${JSON.stringify(import.meta.resolve('msw/node'))};
import { HttpResponse, http } from ${JSON.stringify(import.meta.resolve('msw'))};
const pages = ${JSON.stringify(pages)};
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(RealDate.now() + ${ahead});
    else super(...args);
  }
  static now() {
    return RealDate.now() + ${ahead};
  }
};
const server = setupServer(
  http.get('*/robots.txt', () => new HttpResponse(null, { status: 404 })),
  ...Object.entries(pages).map(([url, { status, body }]) =>
    http.get(url, () => new HttpResponse(body, { status, headers: { 'content-type': 'text/html' } })),
  ),
);
server.events.on('request:start', ({ request }) => process.stderr.write('request ' + request.url + '\\n'));
server.listen({ onUnhandledRequest: 'error' });
`;

// Runs the app with its files in the data folder until the lines it logged
// satisfy until, or thirty seconds pass, then stops it as Ctrl-C does, and
// gives its lines and the URLs it requested.
async function running(
  data: string,
  pages: Readonly<Record<string, Page>>,
  until: (lines: readonly string[]) => boolean,
  ahead = 0,
) {
  await using folder = await mkdtempDisposable(join(tmpdir(), 'internet-'));
  const setup = join(folder.path, 'internet.mjs');
  await writeFile(setup, internet(pages, ahead));
  const app = spawn(
    process.execPath,
    ['--import', setup, join(import.meta.dirname, 'main.ts')],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      // The app keeps its files under XDG_DATA_HOME, here the test's own folder.
      env: { ...process.env, XDG_DATA_HOME: data },
    },
  );
  const lines: string[] = [];
  const requests: string[] = [];
  const errors: string[] = [];
  createInterface({ input: app.stdout }).on('line', (line) => lines.push(line));
  createInterface({ input: app.stderr }).on('line', (line) =>
    line.startsWith('request ')
      ? requests.push(line.slice('request '.length))
      : errors.push(line),
  );
  const exited = once(app, 'exit');
  const deadline = performance.now() + 30_000;
  while (!until(lines) && app.exitCode === null && performance.now() < deadline)
    await setTimeout(100);
  app.kill('SIGINT');
  await exited;
  return { lines, requests, errors: errors.join('\n') };
}

const has = (prefix: string) => (lines: readonly string[]) =>
  lines.some((line) => line.startsWith(prefix));

test('a company page that refuses the crawl is logged as not read, with its address and answer', async () => {
  await using data = await mkdtempDisposable(join(tmpdir(), 'credits-data-'));
  const { lines, errors } = await running(
    data.path,
    {
      ...lists([['https://openai.com/startups/', 'OpenAI', 'API credits']]),
      'https://openai.com/startups/': cloudflareChallenge,
    },
    has('could not read'),
  );

  assert.ok(
    lines.some((line) =>
      line.startsWith(
        'could not read https://openai.com/startups/: Request failed with status code 403',
      ),
    ),
    `${lines.join('\n')}\n${errors}`,
  );
});

test('a page that a list links and that states no credit amount is logged as no program page found, with its list', async () => {
  await using data = await mkdtempDisposable(join(tmpdir(), 'credits-data-'));
  const { lines, errors } = await running(
    data.path,
    {
      ...lists([['https://www.anthropic.com/', 'Anthropic', 'API credits']]),
      'https://www.anthropic.com/': anthropicHome,
    },
    has('no program page found'),
  );

  assert.ok(
    lines.includes(
      `no program page found https://www.anthropic.com/ (linked by ${avinash})`,
    ),
    `${lines.join('\n')}\n${errors}`,
  );
});

test('a program page is logged as a new program with each credit amount and its sentence, and no other page of GitHub is requested', async () => {
  await using data = await mkdtempDisposable(join(tmpdir(), 'credits-data-'));
  const { lines, requests, errors } = await running(
    data.path,
    {
      ...lists([
        ['https://aws.amazon.com/startups/credits', 'AWS', 'Up to $200,000'],
      ]),
      'https://aws.amazon.com/startups/credits': awsProgram('$200,000'),
    },
    has('new program'),
  );

  assert.ok(
    lines.includes(
      'new program https://aws.amazon.com/startups/credits: $200,000 ("Apply for up to $200,000 in AWS Activate Credits, with additional credits available for AI startups ready to scale."); $5,000 ("Up to $5,000 USD in Activate Credits")',
    ),
    `${lines.join('\n')}\n${errors}`,
  );
  assert.deepEqual(
    // Each list is a crawl of its own, which reads robots.txt itself.
    [
      ...new Set(
        requests.filter((url) => new URL(url).hostname === 'github.com'),
      ),
    ].sort(),
    [avinash, doanbactam, 'https://github.com/robots.txt'],
  );
});

// Sentences from the program pages that the first live run on the two lists
// read on 2026-10-30, with the credit amounts each page offers; null is a
// page that offers none, whose figures are a funding round or a fund.
const liveRun: readonly (readonly [
  string,
  string,
  readonly string[] | null,
])[] = [
  [
    'https://aws.amazon.com/startups/',
    '<p>Apply to receive up to $200,000 in AWS Activate Credits to offset costs on infrastructure, data services, and AI/ML models.</p>',
    ['$200,000'],
  ],
  [
    'https://www.microsoft.com/en-us/startups',
    '<p>Access cutting-edge AI models, developer tools, and up to $150,000 in credits, backed by Microsoft’s global customer network.</p>',
    ['$150,000'],
  ],
  [
    'https://www.cloudflare.com/startups/',
    '<p>Cloudflare for Startups gives early-stage companies up to $350k in credits to build the next big idea.</p>',
    ['$350k'],
  ],
  [
    'https://www.linode.com/',
    '<h2>Get up to US$5,000 in cloud credits*</h2>',
    ['$5,000'],
  ],
  [
    'https://estuary.dev/startup/',
    '<p>To help you get off the ground, we offer an exclusive startup program with $2,000 of free Estuary credits over 12 months.</p>',
    ['$2,000'],
  ],
  [
    'https://education.github.com/pack',
    '<p>Enjoy a credit of $13 USD per month for 24 months.</p>',
    ['$13'],
  ],
  [
    'https://claude.com/programs/startups',
    '<p>Access discounts and credits worth up to $45,000 from companies building with Claude.</p><p>You may be eligible to receive up to $100K in additional API credits, claimed through your VC.</p>',
    ['$45,000', '$100K'],
  ],
  [
    'https://www.intercom.com/early-stage',
    '<p>Program members get credits and discounts worth $500K on Stripe, Notion, Linear and more.</p>',
    ['$500K'],
  ],
  [
    'https://zed.dev/education',
    '<p>Everything in Zed Pro: all Pro features, unlimited edit predictions, and $10/month in AI token credits.</p>',
    ['$10'],
  ],
  [
    'https://livekit.com/startups',
    '<p>Get up to $23K in infrastructure and inference credits, plus LiveKit’s realtime platform to build, test, launch, and scale your product.</p>',
    ['$23K'],
  ],
  [
    'https://temporal.io/startup',
    '<p>Our startup program offers $6,000 in Temporal Cloud credits to funded startups that have raised $30M or less.</p>',
    ['$6,000'],
  ],
  [
    'https://circleci.com/startup-program/',
    '<h1>Up to $20,000 of free compute credits for eligible startups</h1><p>With this offer, you receive significantly more compute credits than the standard Performance Plan, free Starter Support (valued at $249 per month) at no cost during the program.</p>',
    ['$20,000'],
  ],
  [
    'https://stripe.com/atlas',
    '<p>Save with over $200K in offers from partners like AWS, Google, and Xero, and get $2.5K in credits for Stripe products.</p>',
    ['$2.5K'],
  ],
  [
    'https://www.antler.co/',
    '<p>Salmon has raised $100M to build a digital bank for the Philippines’ mobile-first generation to redefine banking and credit for millions of users.</p>',
    null,
  ],
  [
    'https://nebius.com/startups',
    '<p>Important: Credit offerings are currently available through our VC partners to startups that have raised $5M+.</p>',
    null,
  ],
  [
    'https://developers.openai.com/community/codex-for-oss',
    '<p>Over the past year, the Codex Open Source Fund ($1 million) has supported projects that need API credits.</p>',
    null,
  ],
  [
    'https://aicreditradar.com/',
    '<p>Pydantic Logfire Personal plan: 10M logs, spans and metrics per month ($20/month usage credit), hard-capped at $0.</p>',
    ['$20'],
  ],
];

test('a dollar figure counts as credits only when the word credit stands next to it, as on the pages of the first live run', async () => {
  await using data = await mkdtempDisposable(join(tmpdir(), 'credits-data-'));
  const reported = (lines: readonly string[]) =>
    lines.filter(
      (line) =>
        line.startsWith('new program') ||
        line.startsWith('no program page found'),
    );
  const { lines, errors } = await running(
    data.path,
    {
      ...lists(liveRun.map(([url]) => [url, new URL(url).hostname, ''])),
      ...Object.fromEntries(
        liveRun.map(([url, body]) => [
          url,
          ok(
            `<!doctype html><html><head><title>${new URL(url).hostname}</title></head><body><main>${body}</main></body></html>`,
          ),
        ]),
      ),
    },
    (lines) => reported(lines).length === liveRun.length,
  );

  const amounts = new Map(
    reported(lines).map((line) => {
      const program = /^new program (\S+): (.*)$/u.exec(line);
      return program
        ? [
            program[1],
            [
              ...(program[2] ?? '').matchAll(
                /(\$\S+?(?: million| thousand)?) \("/gu,
              ),
            ].map(([, amount]) => amount),
          ]
        : [line.split(' ')[4], null];
    }),
  );
  assert.deepEqual(
    Object.fromEntries(amounts),
    Object.fromEntries(liveRun.map(([url, , expected]) => [url, expected])),
    errors,
  );
});

test('a dollar figure in a sentence that names no credits is not a credit amount', async () => {
  await using data = await mkdtempDisposable(join(tmpdir(), 'credits-data-'));
  const { lines, errors } = await running(
    data.path,
    {
      ...lists([
        ['https://cloud.google.com/startup', 'Google', 'Up to $350,000'],
      ]),
      'https://cloud.google.com/startup': googleProgram,
    },
    has('new program'),
  );

  assert.ok(
    lines.includes(
      'new program https://cloud.google.com/startup: $350,000 ("Up to $350,000 in Cloud credits over two years.")',
    ),
    `${lines.join('\n')}\n${errors}`,
  );
});

test('a program whose amount changes is logged as amount changed after a restart, and the restart logs nothing else', async () => {
  await using data = await mkdtempDisposable(join(tmpdir(), 'credits-data-'));
  const rows = [
    ['https://aws.amazon.com/startups/credits', 'AWS', 'Up to $200,000'],
    ['https://www.microsoft.com/en-us/startups', 'Microsoft', 'Up to $150,000'],
  ] as const;
  const first = await running(
    data.path,
    {
      ...lists(rows),
      'https://aws.amazon.com/startups/credits': awsProgram('$200,000'),
      'https://www.microsoft.com/en-us/startups': microsoftProgram,
    },
    (lines) =>
      lines.filter((line) => line.startsWith('new program')).length === 2,
  );
  assert.equal(
    first.lines.filter((line) => line.startsWith('new program')).length,
    2,
    `${first.lines.join('\n')}\n${first.errors}`,
  );

  // A month later, when every page is due again.
  const second = await running(
    data.path,
    {
      ...lists(rows),
      'https://aws.amazon.com/startups/credits': awsProgram('$100,000'),
      'https://www.microsoft.com/en-us/startups': microsoftProgram,
    },
    has('amount changed'),
    31 * 24 * 3_600_000,
  );

  assert.deepEqual(
    second.lines,
    [
      'amount changed https://aws.amazon.com/startups/credits: $200,000, $5,000 → $100,000, $5,000',
    ],
    second.errors,
  );
});
