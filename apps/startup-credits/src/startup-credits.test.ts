import { watchStartupCredits } from './startup-credits.ts';

import assert from 'node:assert/strict';
import { mkdtempDisposable } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';

import { HttpServer, type HttpServerHandle } from '@zukhruf/testing/http';

const listPath = '/lists/startup-credits';

// A GitHub list as github.com renders it, trimmed from
// github.com/doanbactam/awesome-builder-programs on 2026-10-30: GitHub's own
// links in its header and file list, and the README table that links each
// program's own page.
const githubList = (rows: readonly (readonly [string, string, string])[]) =>
  `<!doctype html><html><head><title>GitHub - lists/startup-credits</title></head><body>
<header><a href="/">GitHub</a><a href="/login?return_to=%2Flists%2Fstartup-credits">Sign in</a></header>
<main><div role="grid"><a href="${listPath}/blob/main/LICENSE">LICENSE</a></div>
<article class="markdown-body entry-content container-lg" itemprop="text"><table>
<thead><tr><th>Program</th><th>Provider</th><th>Benefit</th></tr></thead><tbody>
${rows.map(([href, provider, benefit]) => `<tr><td><a href="${href}" rel="nofollow">${provider}</a></td><td>${provider}</td><td>${benefit}</td></tr>`).join('\n')}
</tbody></table></article></main></body></html>`;

// aws.amazon.com/startups/credits, trimmed on 2026-10-30, with its
// non-breaking spaces.
const awsProgram = (amount: string) =>
  `<!doctype html><html><head><title>AWS Activate Credits – Up to $200K for Eligible Startups</title></head><body>
<nav><a href="/">AWS</a></nav><main><h1>AWS Activate Credits</h1>
<p>Move from prototype to production faster. Apply for up to&nbsp;${amount} in AWS Activate Credits, with additional credits available for AI startups ready to scale.&nbsp;</p>
<p>Up to $5,000&nbsp;USD in Activate Credits&nbsp;</p></main></body></html>`;

// microsoft.com/en-us/startups, trimmed on 2026-10-30.
const microsoftProgram = `<!doctype html><html><head><title>Microsoft for Startups | Microsoft</title></head><body>
<main><h1>Microsoft for Startups</h1><p>Access cutting-edge AI models, developer tools, and <b>up to $150,000 in credits</b>, backed by Microsoft’s global customer network.</p></main></body></html>`;

// www.anthropic.com, trimmed on 2026-10-30: a home page that names no
// program.
const anthropicHome = `<!doctype html><html><head><title>Home \\ Anthropic</title></head><body>
<main><h1>AI research and products that put safety at the frontier.</h1>
<p>Anthropic is a Public Benefit Corporation (PBC), a designation that requires us to balance the financial interests of shareholders with the benefit to the broader public.</p></main></body></html>`;

// cloud.google.com/startup, trimmed on 2026-10-30: a tier's dollar figure in
// a sentence that names no credits.
const googleProgram = `<!doctype html><html><head><title>Google for Startups Cloud Program</title></head><body>
<main><h1>Google for Startups Cloud Program</h1><p>Up to $350,000 in Cloud credits over two years.</p>
<ul><li>Start ($2k) tier is designed for startups founded in the past 2 years, with a working MVP, a clear business model, and plans to seek venture funding soon.</li></ul></main></body></html>`;

// A website that answers its pages and nothing else; robots.txt is missing,
// which allows every URL.
function website(
  pages: Readonly<Record<string, () => { status: number; body: string }>>,
  requests: string[] = [],
) {
  return (request: IncomingMessage, response: ServerResponse) => {
    const path = request.url ?? '';
    requests.push(path);
    const page = pages[path]?.() ?? { status: 404, body: '' };
    response.writeHead(page.status, { 'content-type': 'text/html' });
    response.end(page.body);
  };
}

const ok = (body: string) => () => ({ status: 200, body });

// The list's URL on localhost, while the companies are on 127.0.0.1: one
// machine, two host names, as a list on github.com links other websites.
const listOn = (server: HttpServerHandle) =>
  `http://localhost:${new URL(server.origin).port}${listPath}`;

// Watches the list until the lines logged so far satisfy until, or ten
// seconds pass, and gives every line it logged.
async function watching(
  list: string,
  directory: string,
  until: (lines: readonly string[]) => boolean,
) {
  const lines: string[] = [];
  const stop = new AbortController();
  const ended = watchStartupCredits({
    lists: [list],
    directory,
    log: (line) => lines.push(line),
    signal: stop.signal,
  });
  const deadline = performance.now() + 10_000;
  while (!until(lines) && performance.now() < deadline) await setTimeout(50);
  stop.abort();
  await ended;
  return lines;
}

const has = (prefix: string) => (lines: readonly string[]) =>
  lines.some((line) => line.startsWith(prefix));

test('a company page that refuses the crawl is logged as not read, with its address and answer', async () => {
  await using directory = await mkdtempDisposable(join(tmpdir(), 'credits-'));
  // As openai.com/startups/ answers a crawler: a Cloudflare challenge.
  await using company = await new HttpServer().start(
    website({
      '/startups/': () => ({
        status: 403,
        body: '<!doctype html><html><head><title>Just a moment...</title></head><body></body></html>',
      }),
    }),
  );
  await using list = await new HttpServer().start(
    website({
      [listPath]: ok(
        githubList([[`${company.origin}/startups/`, 'OpenAI', 'API credits']]),
      ),
    }),
  );

  const lines = await watching(
    listOn(list),
    directory.path,
    has('could not read'),
  );

  assert.ok(
    lines.some((line) =>
      line.startsWith(
        `could not read ${company.origin}/startups/: Request failed with status code 403`,
      ),
    ),
    lines.join('\n'),
  );
});

test('a page that the list links and that states no credit amount is logged as no program page found, with its list', async () => {
  await using directory = await mkdtempDisposable(join(tmpdir(), 'credits-'));
  await using company = await new HttpServer().start(
    website({ '/': ok(anthropicHome) }),
  );
  await using list = await new HttpServer().start(
    website({
      [listPath]: ok(
        githubList([[`${company.origin}/`, 'Anthropic', 'API credits']]),
      ),
    }),
  );

  const lines = await watching(
    listOn(list),
    directory.path,
    has('no program page found'),
  );

  assert.ok(
    lines.includes(
      `no program page found ${company.origin}/ (linked by ${listOn(list)})`,
    ),
    lines.join('\n'),
  );
});

test('a program page is logged as a new program with each credit amount and its sentence, and the other pages of the list website are never requested', async () => {
  await using directory = await mkdtempDisposable(join(tmpdir(), 'credits-'));
  await using company = await new HttpServer().start(
    website({ '/startups/credits': ok(awsProgram('$200,000')) }),
  );
  const listRequests: string[] = [];
  await using list = await new HttpServer().start(
    website(
      {
        [listPath]: ok(
          githubList([
            [`${company.origin}/startups/credits`, 'AWS', 'Up to $200,000'],
          ]),
        ),
      },
      listRequests,
    ),
  );

  const lines = await watching(
    listOn(list),
    directory.path,
    has('new program'),
  );

  assert.ok(
    lines.includes(
      `new program ${company.origin}/startups/credits: $200,000 ("Apply for up to $200,000 in AWS Activate Credits, with additional credits available for AI startups ready to scale."); $5,000 ("Up to $5,000 USD in Activate Credits")`,
    ),
    lines.join('\n'),
  );
  assert.deepEqual(listRequests.sort(), [listPath, '/robots.txt']);
});

test('a dollar figure in a sentence that names no credits is not a credit amount', async () => {
  await using directory = await mkdtempDisposable(join(tmpdir(), 'credits-'));
  await using company = await new HttpServer().start(
    website({ '/startup': ok(googleProgram) }),
  );
  await using list = await new HttpServer().start(
    website({
      [listPath]: ok(
        githubList([[`${company.origin}/startup`, 'Google', 'Up to $350,000']]),
      ),
    }),
  );

  const lines = await watching(
    listOn(list),
    directory.path,
    has('new program'),
  );

  assert.ok(
    lines.includes(
      `new program ${company.origin}/startup: $350,000 ("Up to $350,000 in Cloud credits over two years.")`,
    ),
    lines.join('\n'),
  );
});

test('a program whose amount changes is logged as amount changed after a restart, and the restart logs nothing else', async (t) => {
  await using directory = await mkdtempDisposable(join(tmpdir(), 'credits-'));
  let awsAmount = '$200,000';
  await using aws = await new HttpServer().start(
    website({ '/startups/credits': () => ok(awsProgram(awsAmount))() }),
  );
  await using microsoft = await new HttpServer().start(
    website({ '/en-us/startups': ok(microsoftProgram) }),
  );
  await using list = await new HttpServer().start(
    website({
      [listPath]: ok(
        githubList([
          [`${aws.origin}/startups/credits`, 'AWS', 'Up to $200,000'],
          [`${microsoft.origin}/en-us/startups`, 'Microsoft', 'Up to $150,000'],
        ]),
      ),
    }),
  );
  const first = await watching(
    listOn(list),
    directory.path,
    (lines) =>
      lines.filter((line) => line.startsWith('new program')).length === 2,
  );
  assert.equal(
    first.filter((line) => line.startsWith('new program')).length,
    2,
    first.join('\n'),
  );

  // A month later, when every page is due again. The clock keeps moving, as a
  // stopped one stalls the crawl's HTTP client (elt #3372).
  awsAmount = '$100,000';
  t.mock.timers.enable({
    apis: ['Date'],
    now: Date.now() + 31 * 24 * 3_600_000,
  });
  using clock = setInterval(() => t.mock.timers.tick(20), 20);
  const second = await watching(
    listOn(list),
    directory.path,
    has('amount changed'),
  );

  assert.deepEqual(second, [
    `amount changed ${aws.origin}/startups/credits: $200,000, $5,000 → $100,000, $5,000`,
  ]);
});
