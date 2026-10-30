import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempDisposable, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';

// Where the app keeps its files (src/directory.ts). Its data is disposable,
// so each test starts with none and leaves none.
const outputs = join(import.meta.dirname, '../outputs');

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

// Runs the app until the lines it logged satisfy until, or thirty seconds
// pass, then stops it as Ctrl-C does, and gives its lines and the URLs it
// requested.
async function running(
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
    { stdio: ['ignore', 'pipe', 'pipe'] },
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
  await rm(outputs, { recursive: true, force: true });
  try {
    const { lines, errors } = await running(
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
  } finally {
    await rm(outputs, { recursive: true, force: true });
  }
});

test('a page that a list links and that states no credit amount is logged as no program page found, with its list', async () => {
  await rm(outputs, { recursive: true, force: true });
  try {
    const { lines, errors } = await running(
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
  } finally {
    await rm(outputs, { recursive: true, force: true });
  }
});

test('a program page is logged as a new program with each credit amount and its sentence, and no other page of GitHub is requested', async () => {
  await rm(outputs, { recursive: true, force: true });
  try {
    const { lines, requests, errors } = await running(
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
  } finally {
    await rm(outputs, { recursive: true, force: true });
  }
});

test('a dollar figure in a sentence that names no credits is not a credit amount', async () => {
  await rm(outputs, { recursive: true, force: true });
  try {
    const { lines, errors } = await running(
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
  } finally {
    await rm(outputs, { recursive: true, force: true });
  }
});

test('a program whose amount changes is logged as amount changed after a restart, and the restart logs nothing else', async () => {
  await rm(outputs, { recursive: true, force: true });
  try {
    const rows = [
      ['https://aws.amazon.com/startups/credits', 'AWS', 'Up to $200,000'],
      [
        'https://www.microsoft.com/en-us/startups',
        'Microsoft',
        'Up to $150,000',
      ],
    ] as const;
    const first = await running(
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
  } finally {
    await rm(outputs, { recursive: true, force: true });
  }
});
