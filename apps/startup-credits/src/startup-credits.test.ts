import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempDisposable, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';

import { z } from 'zod';

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

// One planned answer of the Messages API to one request about a page: the
// offers whose quote is in the request (invented ones are sent as they are),
// a raw text, an error, or no answer until the app stops.
type Answer =
  | {
      readonly offers: readonly Record<string, unknown>[];
      readonly invented?: readonly Record<string, unknown>[];
    }
  | { readonly text: string }
  | {
      readonly status: number;
      readonly error: { readonly type: string; readonly message: string };
    }
  | { readonly hold: true };

// The token in the app's environment, which the Claude provider sends.
const token = 'sk-ant-oat01-test-token';
// The OpenRouter key in the app's environment, which the decision model
// sends.
const openRouterKey = 'sk-or-v1-test-key';

// What OpenRouter's Decisions API answers for each page: the kind that Jev
// chooses, or an error in OpenRouter's error shape, as a 401 for a wrong key
// came on 2026-10-31, at every request about the page.
type Decision =
  | { readonly kind: string }
  | { readonly status: number; readonly message: string };

// The internet as the app's process sees it in a test, loaded before
// main.ts: GitHub and the companies' websites answer these pages, every
// robots.txt is missing, any other request fails, and each
// request is written to stderr. The Messages API answers each request about
// a page with the next answer planned for it, in the shape of a real Haiku
// 5.5 answer captured on 2026-10-31; OpenRouter's Decisions API answers each
// request about a page with its decision, in the shape of a real Jev 1.14
// answer captured on 2026-10-31. A request with no planned answer or
// decision is written to stderr as unplanned. The clock runs ahead by the
// given milliseconds, since a test cannot wait a month for the pages to be
// due again.
const internet = (
  pages: Readonly<Record<string, Page>>,
  model: Readonly<Record<string, readonly Answer[]>>,
  decisions: Readonly<Record<string, Decision>>,
  ahead: number,
) => `
import { setupServer } from ${JSON.stringify(import.meta.resolve('msw/node'))};
import { HttpResponse, http } from ${JSON.stringify(import.meta.resolve('msw'))};
const pages = ${JSON.stringify(pages)};
const planned = ${JSON.stringify(model)};
const decisions = ${JSON.stringify(decisions)};
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
const fold = (text) => text.replace(/\\s+/gu, ' ').trim().toLowerCase();
const asked = new Map();
const server = setupServer(
  http.get('*/robots.txt', () => new HttpResponse(null, { status: 404 })),
  ...Object.entries(pages).map(([url, { status, body }]) =>
    http.get(url, () => new HttpResponse(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } })),
  ),
  http.post('https://api.anthropic.com/v1/messages', async ({ request }) => {
    const body = await request.json();
    const prompt = body.messages
      .flatMap(({ content }) => content.map(({ text }) => text))
      .join('\\n');
    const page = /^URL: (\\S+)$/mu.exec(prompt)?.[1];
    process.stderr.write('model ' + JSON.stringify({ page, model: body.model, authorization: request.headers.get('authorization') }) + '\\n');
    const index = asked.get(page) ?? 0;
    asked.set(page, index + 1);
    const answer = planned[page]?.[index];
    if (answer === undefined) {
      process.stderr.write('unplanned model request ' + (index + 1) + ' for ' + page + '\\n');
      return HttpResponse.error();
    }
    if ('hold' in answer) return new Promise(() => {});
    if ('status' in answer)
      return HttpResponse.json(
        { type: 'error', error: answer.error },
        { status: answer.status, headers: { 'retry-after': '0' } },
      );
    const text = 'text' in answer
      ? answer.text
      : JSON.stringify({
          offers: [
            ...answer.offers.filter(({ quote }) => fold(prompt).includes(fold(quote))),
            ...(answer.invented ?? []),
          ],
        });
    return HttpResponse.json({
      model: body.model,
      id: 'msg_011CgZ8NhPVMJP8jgkiwcpLf',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text }],
      container: null,
      stop_reason: 'end_turn',
      stop_sequence: null,
      stop_details: null,
      usage: {
        input_tokens: 427,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
        output_tokens: 79,
        output_tokens_details: { thinking_tokens: 0 },
        service_tier: 'standard',
        inference_geo: 'global',
        speed: 'standard',
      },
      diagnostics: null,
    });
  }),
  http.post('https://openrouter.ai/api/alpha/decisions', async ({ request }) => {
    const body = await request.json();
    const page = /^URL: (\\S+)$/mu.exec(body.state)?.[1];
    process.stderr.write('decision ' + JSON.stringify({ page, model: body.model, authorization: request.headers.get('authorization') }) + '\\n');
    const decision = decisions[page];
    const criteria = Object.keys(body.questions.kind.criteria);
    if (decision === undefined || ('kind' in decision && !criteria.includes(decision.kind))) {
      process.stderr.write('unplanned decision for ' + page + '\\n');
      return HttpResponse.error();
    }
    if ('status' in decision)
      return HttpResponse.json(
        { error: { message: decision.message, code: decision.status } },
        { status: decision.status, headers: { 'retry-after': '0' } },
      );
    return HttpResponse.json(
      {
        model: 'typesafe/jev-1.14-20261014',
        answers: {
          kind: {
            type: 'choice',
            choice: decision.kind,
            probabilities: Object.fromEntries(criteria.map((kind) => [kind, kind === decision.kind ? 1 : 0])),
            confidence: 1,
          },
        },
        usage: { input_tokens: 351, output_tokens: 31, cost: 0.000014742 },
        id: 'gen-dec-1793424713-wGFdCAJhdI68yDBeKJAj',
        provider: 'TypeSafe',
      },
      { headers: { 'x-generation-id': 'gen-dec-1793424713-wGFdCAJhdI68yDBeKJAj', 'x-provider-name': 'TypeSafe' } },
    );
  }),
);
server.events.on('request:start', ({ request }) => process.stderr.write('request ' + request.url + '\\n'));
server.listen({ onUnhandledRequest: 'error' });
`;

// One request to the Messages API or to the Decisions API, as the internet
// writes it to stderr.
const askedSchema = z.object({
  page: z.string(),
  model: z.string(),
  authorization: z.string(),
});
type Asked = z.infer<typeof askedSchema>;

// Runs the app with its files in the data folder until what it logged and
// asked the models satisfy until, it exits, or thirty seconds pass, then
// stops it as Ctrl-C does. Gives its lines, the URLs it requested, each
// request to the offer model (asked) and to the decision model (decided), its
// exit code and stderr. A model request that the test did not plan fails the
// test.
async function running(
  data: string,
  {
    pages,
    model,
    decisions,
    until,
    ahead,
  }: {
    readonly pages: Readonly<Record<string, Page>>;
    readonly model: Readonly<Record<string, readonly Answer[]>>;
    readonly decisions: Readonly<Record<string, Decision>>;
    readonly until: (
      lines: readonly string[],
      asked: readonly Asked[],
      decided: readonly Asked[],
    ) => boolean;
    readonly ahead: number;
  },
) {
  await using folder = await mkdtempDisposable(join(tmpdir(), 'internet-'));
  const setup = join(folder.path, 'internet.mjs');
  await writeFile(setup, internet(pages, model, decisions, ahead));
  const app = spawn(
    process.execPath,
    ['--import', setup, join(import.meta.dirname, 'main.ts')],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      // Only what the app needs, and none of the developer's logins:
      // XDG_DATA_HOME, the test's own folder, holds the app's files, the
      // Claude provider sends CLAUDE_CODE_OAUTH_TOKEN without reading a
      // stored login, and the decision model sends OPENROUTER_API_KEY.
      env: {
        XDG_DATA_HOME: data,
        CLAUDE_CODE_OAUTH_TOKEN: token,
        OPENROUTER_API_KEY: openRouterKey,
      },
    },
  );
  const lines: string[] = [];
  const requests: string[] = [];
  const asked: Asked[] = [];
  const decided: Asked[] = [];
  const unplanned: string[] = [];
  const errors: string[] = [];
  createInterface({ input: app.stdout }).on('line', (line) => lines.push(line));
  createInterface({ input: app.stderr }).on('line', (line) => {
    if (line.startsWith('request '))
      requests.push(line.slice('request '.length));
    else if (line.startsWith('model '))
      asked.push(askedSchema.parse(JSON.parse(line.slice('model '.length))));
    else if (line.startsWith('decision '))
      decided.push(
        askedSchema.parse(JSON.parse(line.slice('decision '.length))),
      );
    else if (line.startsWith('unplanned ')) unplanned.push(line);
    else errors.push(line);
  });
  const exited = once(app, 'exit');
  const deadline = performance.now() + 30_000;
  while (
    !until(lines, asked, decided) &&
    app.exitCode === null &&
    performance.now() < deadline
  )
    await setTimeout(100);
  app.kill('SIGINT');
  const [code] = await exited;
  assert.deepEqual(unplanned, [], errors.join('\n'));
  return {
    lines,
    requests,
    asked,
    decided,
    code,
    errors: errors.join('\n'),
  };
}

// Jev labels each of these pages program.
const programs = (...pages: readonly string[]) =>
  Object.fromEntries(pages.map((page) => [page, { kind: 'program' }]));

const has = (prefix: string) => (lines: readonly string[]) =>
  lines.some((line) => line.startsWith(prefix));

// True two seconds after the model was asked about the page the given number
// of times: the app checks its rows every second, so a line that the last
// answer causes is logged by then.
function quietAfter(page: string, calls: number) {
  let at: number | undefined;
  return (_lines: readonly string[], asked: readonly Asked[]) => {
    if (
      at === undefined &&
      asked.filter((call) => call.page === page).length >= calls
    )
      at = performance.now();
    return at !== undefined && performance.now() - at > 2_000;
  };
}

test('a 401 from the model ends the app with the reason, and logs no page as not extracted', async () => {
  await using data = await mkdtempDisposable(join(tmpdir(), 'credits-data-'));
  const rejected: Answer = {
    status: 401,
    error: { type: 'authentication_error', message: 'Invalid bearer token' },
  };
  const { lines, code, errors } = await running(data.path, {
    pages: {
      ...lists([
        ['https://aws.amazon.com/startups/credits', 'AWS', 'Up to $200,000'],
        [
          'https://www.microsoft.com/en-us/startups',
          'Microsoft',
          'Up to $150,000',
        ],
      ]),
      'https://aws.amazon.com/startups/credits': awsProgram('$200,000'),
      'https://www.microsoft.com/en-us/startups': microsoftProgram,
    },
    model: {
      'https://aws.amazon.com/startups/credits': [rejected],
      'https://www.microsoft.com/en-us/startups': [rejected],
    },
    until: () => false,
    decisions: programs(
      'https://aws.amazon.com/startups/credits',
      'https://www.microsoft.com/en-us/startups',
    ),
    ahead: 0,
  });

  assert.notEqual(code, 0, `${lines.join('\n')}\n${errors}`);
  assert.match(errors, /Invalid bearer token/u);
  assert.deepEqual(
    lines.filter((line) => line.startsWith('could not extract')),
    [],
  );
});

test('a page whose model calls stay rate limited after the AI SDK retries is logged as could not extract once, also when it fails again after a restart, the other page still reports, and a later pass that succeeds reports the page', async () => {
  await using data = await mkdtempDisposable(join(tmpdir(), 'credits-data-'));
  const aws = 'https://aws.amazon.com/startups/credits';
  const microsoft = 'https://www.microsoft.com/en-us/startups';
  const pages = {
    ...lists([
      [aws, 'AWS', 'Up to $200,000'],
      [microsoft, 'Microsoft', 'Up to $150,000'],
    ]),
    [aws]: awsProgram('$200,000'),
    [microsoft]: microsoftProgram,
  };
  // The body of a real 429 of the Messages API, captured on 2026-10-31.
  const limited: Answer = {
    status: 429,
    error: {
      type: 'rate_limit_error',
      message:
        "This request would exceed your account's rate limit. Please try again later.",
    },
  };
  const overloaded: Answer = {
    status: 529,
    error: { type: 'overloaded_error', message: 'Overloaded' },
  };
  const awsOffers: Answer = {
    offers: [
      {
        quote:
          'Apply for up to $200,000 in AWS Activate Credits, with additional credits available for AI startups ready to scale.',
        kind: 'credits',
        value: { amount: 200_000, currency: 'USD' },
        duration: null,
        who: null,
      },
    ],
  };
  const first = await running(data.path, {
    pages,
    model: {
      // A first call and the AI SDK's two retries.
      [aws]: [limited, limited, limited],
      [microsoft]: [
        {
          offers: [
            {
              quote:
                'Access cutting-edge AI models, developer tools, and up to $150,000 in credits, backed by Microsoft’s global customer network.',
              kind: 'credits',
              value: { amount: 150_000, currency: 'USD' },
              duration: null,
              who: null,
            },
          ],
        },
      ],
    },
    until: (lines) =>
      has('could not extract')(lines) && has('new program')(lines),
    decisions: programs(aws, microsoft),
    ahead: 0,
  });
  assert.deepEqual(
    first.lines.toSorted(),
    [
      `could not extract ${aws}: This request would exceed your account's rate limit. Please try again later.`,
      `new program ${microsoft}: credits $150,000 ("Access cutting-edge AI models, developer tools, and up to $150,000 in credits, backed by Microsoft’s global customer network.")`,
    ],
    first.errors,
  );

  // A month later the failed page is asked again and fails for another
  // reason.
  const second = await running(data.path, {
    pages,
    model: { [aws]: [overloaded, overloaded, overloaded] },
    until: quietAfter(aws, 3),
    decisions: programs(aws, microsoft),
    ahead: 31 * 24 * 3_600_000,
  });
  assert.equal(second.asked.length, 3, second.errors);
  assert.deepEqual(second.lines, [], second.errors);

  const third = await running(data.path, {
    pages,
    model: { [aws]: [awsOffers] },
    until: has('new program'),
    decisions: programs(aws, microsoft),
    ahead: 62 * 24 * 3_600_000,
  });
  assert.deepEqual(
    third.lines,
    [
      `new program ${aws}: credits $200,000 ("Apply for up to $200,000 in AWS Activate Credits, with additional credits available for AI startups ready to scale.")`,
    ],
    third.errors,
  );
});

test('an answer that does not match the offer schema is logged as could not extract', async () => {
  await using data = await mkdtempDisposable(join(tmpdir(), 'credits-data-'));
  const aws = 'https://aws.amazon.com/startups/credits';
  const { lines, errors } = await running(data.path, {
    pages: {
      ...lists([[aws, 'AWS', 'Up to $200,000']]),
      [aws]: awsProgram('$200,000'),
    },
    // An offer with no quote, as a model that skips the schema answers.
    model: { [aws]: [{ text: '{"offers":[{"kind":"credits"}]}' }] },
    until: has('could not extract'),
    decisions: programs(aws),
    ahead: 0,
  });

  assert.deepEqual(
    lines,
    [
      `could not extract ${aws}: No object generated: response did not match schema.`,
    ],
    errors,
  );
});

test('an offer whose quote is not in the page is not reported, and a program page whose quotes are all invented is logged as a new program with no offer found', async () => {
  await using data = await mkdtempDisposable(join(tmpdir(), 'credits-data-'));
  const aws = 'https://aws.amazon.com/startups/credits';
  const microsoft = 'https://www.microsoft.com/en-us/startups';
  // What a small model answered on the first live run: its own prompt as
  // the quote.
  const echo = {
    quote:
      'For each offer, first copy the one sentence of the page text that states it, word for word, as quote',
    kind: 'support',
    who: null,
  };
  const { lines, errors } = await running(data.path, {
    pages: {
      ...lists([
        [aws, 'AWS', 'Up to $200,000'],
        [microsoft, 'Microsoft', 'Up to $150,000'],
      ]),
      [aws]: awsProgram('$200,000'),
      [microsoft]: microsoftProgram,
    },
    model: {
      [aws]: [
        {
          offers: [
            {
              quote: 'Up to $5,000 USD in Activate Credits',
              kind: 'credits',
              value: { amount: 5_000, currency: 'USD' },
              duration: null,
              who: null,
            },
          ],
          invented: [
            echo,
            {
              quote: 'Get up to $350k in credits',
              kind: 'credits',
              value: { amount: 350_000, currency: 'USD' },
              duration: null,
              who: null,
            },
          ],
        },
      ],
      [microsoft]: [{ offers: [], invented: [echo] }],
    },
    until: (lines) =>
      lines.filter((line) => line.startsWith('new program')).length === 2,
    decisions: programs(aws, microsoft),
    ahead: 0,
  });

  assert.deepEqual(
    lines.toSorted(),
    [
      `new program ${aws}: credits $5,000 ("Up to $5,000 USD in Activate Credits")`,
      `new program ${microsoft}: no offer found`,
    ],
    errors,
  );
});

test('an offer that the answer repeats, with the same kind and value or a value-less offer of an overlapping sentence, is reported once, and two different support offers both stay', async () => {
  await using data = await mkdtempDisposable(join(tmpdir(), 'credits-data-'));
  const vercel = 'https://vercel.com/startups';
  const credits = (quote: string) => ({
    quote,
    kind: 'credits',
    value: { amount: 30_000, currency: 'USD' },
    duration: null,
    who: null,
  });
  const discount = (quote: string) => ({
    quote,
    kind: 'discount',
    percent: 50,
    duration: '12 months',
    who: null,
  });
  const support = (quote: string) => ({ quote, kind: 'support', who: null });
  const perks = (quote: string) => ({
    quote,
    kind: 'perks',
    value: null,
    who: null,
  });
  const { lines, errors } = await running(data.path, {
    pages: {
      ...lists([[vercel, 'Vercel', 'Up to $30,000']]),
      [vercel]:
        ok(`<!doctype html><html><head><title>Vercel for Startups</title></head><body>
<main><h1>Vercel for Startups</h1><h2>Up to $30,000 in credits</h2>
<p>Eligible teams get up to $30,000 in credits for their first year.</p>
<p>50% off Pro for 12 months.</p>
<p>Members also get 50% off Pro for 12 months when they upgrade.</p>
<p>Startup-focused support from our solutions engineers.</p>
<p>Office hours with our founders every month.</p>
<p>Partner deals from Stripe, Notion and Linear for every member.</p>
<p>$10,000 in credits for the Start tier.</p>
<p>$25,000 in credits for the Scale tier.</p></main></body></html>`),
    },
    model: {
      [vercel]: [
        {
          offers: [
            credits('Up to $30,000 in credits'),
            credits(
              'Eligible teams get up to $30,000 in credits for their first year.',
            ),
            discount('50% off Pro for 12 months.'),
            discount(
              'Members also get 50% off Pro for 12 months when they upgrade.',
            ),
            support('Startup-focused support from our solutions engineers.'),
            support('support from our solutions engineers'),
            support('Office hours with our founders every month.'),
            // Two quotes that share more than half of the shorter one, and
            // neither holds the other.
            perks('Partner deals from Stripe, Notion and Linear'),
            perks('Stripe, Notion and Linear for every member.'),
            // Two tiers: credits of other amounts are other offers.
            {
              quote: '$10,000 in credits for the Start tier.',
              kind: 'credits',
              value: { amount: 10_000, currency: 'USD' },
              duration: null,
              who: null,
            },
            {
              quote: '$25,000 in credits for the Scale tier.',
              kind: 'credits',
              value: { amount: 25_000, currency: 'USD' },
              duration: null,
              who: null,
            },
          ],
        },
      ],
    },
    until: has('new program'),
    decisions: programs(vercel),
    ahead: 0,
  });

  assert.deepEqual(
    lines,
    [
      `new program ${vercel}: credits $30,000 ("Up to $30,000 in credits"); discount 50% ("50% off Pro for 12 months."); support ("Startup-focused support from our solutions engineers."); support ("Office hours with our founders every month."); perks ("Partner deals from Stripe, Notion and Linear"); credits $10,000 ("$10,000 in credits for the Start tier."); credits $25,000 ("$25,000 in credits for the Scale tier.")`,
    ],
    errors,
  );
});

test('a program page is logged as a new program with the kind, value and quote of each offer, Jev 1.14 labels it through OpenRouter with the key, the offer model gets the whole page from Claude Haiku 5.5 with the token, and no other page of GitHub is requested', async () => {
  await using data = await mkdtempDisposable(join(tmpdir(), 'credits-data-'));
  const ovh = 'https://startup.ovhcloud.com/en/';
  // Questions and answers that put the last offer after the first 20,000
  // characters of the page text.
  const questions = Array.from(
    { length: 30 },
    (_, index) =>
      `<p>Question ${index + 1}: who can apply? ${'Startups that are less than five years old, that have raised less than ten million euros, and that build a digital product can apply to the program through one of our partners or directly on this page. '.repeat(4)}</p>`,
  ).join('\n');
  const { lines, requests, asked, decided, errors } = await running(data.path, {
    pages: {
      ...lists([[ovh, 'OVHcloud', 'Up to €100,000']]),
      [ovh]:
        ok(`<!doctype html><html><head><title>OVHcloud Startup Program</title></head><body>
<main><h1>OVHcloud Startup Program</h1>
<p>Get €10,000 of free cloud credits to launch your project.</p>
<h2>MEMBERS GET 50% OFF OVHCLOUD SUPPORT PLANS</h2>
${questions}
<p>Enjoy 12 months of free access to the Pro plan.</p></main></body></html>`),
    },
    model: {
      [ovh]: [
        {
          offers: [
            {
              quote:
                'Get €10,000 of free cloud credits to launch your project.',
              kind: 'credits',
              value: { amount: 10_000, currency: 'EUR' },
              duration: null,
              who: null,
            },
            {
              // The page text writes the heading in capitals.
              quote: 'Members get 50% off OVHcloud support plans',
              kind: 'discount',
              percent: 50,
              duration: null,
              who: null,
            },
            {
              quote: 'Enjoy 12 months of free access to the Pro plan.',
              kind: 'free_period',
              months: 12,
              who: null,
            },
          ],
        },
      ],
    },
    until: has('new program'),
    decisions: programs(ovh),
    ahead: 0,
  });

  assert.deepEqual(
    lines,
    [
      `new program ${ovh}: credits €10,000 ("Get €10,000 of free cloud credits to launch your project."); discount 50% ("Members get 50% off OVHcloud support plans"); free_period 12 months ("Enjoy 12 months of free access to the Pro plan.")`,
    ],
    errors,
  );
  assert.deepEqual(asked, [
    { page: ovh, model: 'claude-haiku-5-5', authorization: `Bearer ${token}` },
  ]);
  assert.deepEqual(decided, [
    {
      page: ovh,
      model: 'typesafe/jev-1.14',
      authorization: `Bearer ${openRouterKey}`,
    },
  ]);
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

// The AWS page with a free period of the given months.
const awsWithSupport = (amount: string, months: number) =>
  ok(
    awsProgram(amount).body.replace(
      '</main>',
      `<p>Get AWS Business Support free for ${months} months.</p></main>`,
    ),
  );

// The offers of the AWS page as the model states them, with its amount and
// the months of its free period.
const awsOffers = (amount: number, quote: string, months: number): Answer => ({
  offers: [
    {
      quote,
      kind: 'credits',
      value: { amount, currency: 'USD' },
      duration: null,
      who: null,
    },
    {
      quote: 'Up to $5,000 USD in Activate Credits',
      kind: 'credits',
      value: { amount: 5_000, currency: 'USD' },
      duration: null,
      who: null,
    },
    {
      quote: `Get AWS Business Support free for ${months} months.`,
      kind: 'free_period',
      months,
      who: null,
    },
  ],
});
const microsoftOffers: Answer = {
  offers: [
    {
      quote: 'up to $150,000 in credits',
      kind: 'credits',
      value: { amount: 150_000, currency: 'USD' },
      duration: null,
      who: null,
    },
  ],
};

test('a program whose offers change is logged as offers changed after a restart, the restart logs nothing else, and only the changed page goes to the model', async () => {
  await using data = await mkdtempDisposable(join(tmpdir(), 'credits-data-'));
  const aws = 'https://aws.amazon.com/startups/credits';
  const microsoft = 'https://www.microsoft.com/en-us/startups';
  const rows = [
    [aws, 'AWS', 'Up to $200,000'],
    [microsoft, 'Microsoft', 'Up to $150,000'],
  ] as const;
  const first = await running(data.path, {
    pages: {
      ...lists(rows),
      [aws]: awsWithSupport('$200,000', 6),
      [microsoft]: microsoftProgram,
    },
    model: {
      [aws]: [
        awsOffers(
          200_000,
          'Apply for up to $200,000 in AWS Activate Credits',
          6,
        ),
      ],
      [microsoft]: [microsoftOffers],
    },
    until: (lines) =>
      lines.filter((line) => line.startsWith('new program')).length === 2,
    decisions: programs(aws, microsoft),
    ahead: 0,
  });
  assert.equal(
    first.lines.filter((line) => line.startsWith('new program')).length,
    2,
    `${first.lines.join('\n')}\n${first.errors}`,
  );

  // A month later, when every page is due again. The model is planned for
  // the changed page only.
  const quiet = quietAfter(aws, 1);
  const second = await running(data.path, {
    pages: {
      ...lists(rows),
      [aws]: awsWithSupport('$100,000', 3),
      [microsoft]: microsoftProgram,
    },
    model: {
      [aws]: [
        awsOffers(
          100_000,
          'Apply for up to $100,000 in AWS Activate Credits',
          3,
        ),
      ],
    },
    until: (lines, asked) =>
      has('offers changed')(lines) && quiet(lines, asked),
    decisions: programs(aws, microsoft),
    ahead: 31 * 24 * 3_600_000,
  });

  assert.deepEqual(
    second.lines,
    [
      `offers changed ${aws}: credits $200,000, credits $5,000, free_period 6 months → credits $100,000, credits $5,000, free_period 3 months`,
    ],
    second.errors,
  );
  assert.deepEqual(
    second.asked.map(({ page }) => page),
    [aws],
  );
});

test('a page whose text changes outside its offers, and whose new answer quotes the same offers in other words, logs nothing after a restart', async () => {
  await using data = await mkdtempDisposable(join(tmpdir(), 'credits-data-'));
  const microsoft = 'https://www.microsoft.com/en-us/startups';
  const rows = [[microsoft, 'Microsoft', 'Up to $150,000']] as const;
  const first = await running(data.path, {
    pages: { ...lists(rows), [microsoft]: microsoftProgram },
    model: { [microsoft]: [microsoftOffers] },
    until: has('new program'),
    decisions: programs(microsoft),
    ahead: 0,
  });
  assert.ok(has('new program')(first.lines), first.errors);

  const second = await running(data.path, {
    pages: {
      ...lists(rows),
      [microsoft]:
        ok(`<!doctype html><html><head><title>Microsoft for Startups | Microsoft</title></head><body>
<main><h1>Microsoft for Startups</h1><p>Access cutting-edge AI models, developer tools, and <b>up to $150,000 in credits</b>, backed by Microsoft’s global customer network.</p>
<p>Join more than 100,000 founders who build on Azure.</p></main></body></html>`),
    },
    model: {
      [microsoft]: [
        {
          offers: [
            {
              quote:
                'Access cutting-edge AI models, developer tools, and up to $150,000 in credits',
              kind: 'credits',
              value: { amount: 150_000, currency: 'USD' },
              duration: null,
              who: null,
            },
          ],
        },
      ],
    },
    until: quietAfter(microsoft, 1),
    decisions: programs(microsoft),
    ahead: 31 * 24 * 3_600_000,
  });

  assert.equal(second.asked.length, 1, second.errors);
  assert.deepEqual(second.lines, [], second.errors);
});

test('a page whose text changes, and whose new answer adds an offer with no value and quotes its free period in other words, logs nothing after a restart', async () => {
  await using data = await mkdtempDisposable(join(tmpdir(), 'credits-data-'));
  const notion = 'https://www.notion.com/startups';
  const rows = [[notion, 'Notion', 'Free Plus plan']] as const;
  const page = (more: string) =>
    ok(`<!doctype html><html><head><title>Notion for Startups</title></head><body>
<main><h1>Notion for Startups</h1><p>Get up to $1,000 in Notion credits.</p>
<p>One year free of the Plus plan, with Notion AI included.</p>
<p>Startup office hours with our team every week.</p>${more}</main></body></html>`);
  const credits = {
    quote: 'Get up to $1,000 in Notion credits.',
    kind: 'credits',
    value: { amount: 1_000, currency: 'USD' },
    duration: null,
    who: null,
  };
  const first = await running(data.path, {
    pages: { ...lists(rows), [notion]: page('') },
    model: {
      [notion]: [
        {
          offers: [
            credits,
            {
              quote: 'One year free of the Plus plan, with Notion AI included.',
              kind: 'free_period',
              months: 12,
              who: null,
            },
          ],
        },
      ],
    },
    until: has('new program'),
    decisions: programs(notion),
    ahead: 0,
  });
  assert.deepEqual(
    first.lines,
    [
      `new program ${notion}: credits $1,000 ("Get up to $1,000 in Notion credits."); free_period 12 months ("One year free of the Plus plan, with Notion AI included.")`,
    ],
    first.errors,
  );

  // The new answer lists the offers in the other order, and adds a free
  // period that states no length.
  const second = await running(data.path, {
    pages: {
      ...lists(rows),
      [notion]: page(
        '<p>Over 10,000 startups build on Notion.</p><p>Members keep the Plus plan free for as long as they stay eligible.</p>',
      ),
    },
    model: {
      [notion]: [
        {
          offers: [
            {
              quote:
                'Members keep the Plus plan free for as long as they stay eligible.',
              kind: 'free_period',
              months: null,
              who: null,
            },
            {
              quote: 'Startup office hours with our team every week.',
              kind: 'support',
              who: null,
            },
            {
              quote: 'One year free of the Plus plan',
              kind: 'free_period',
              months: 12,
              who: null,
            },
            credits,
          ],
        },
      ],
    },
    until: quietAfter(notion, 1),
    decisions: programs(notion),
    ahead: 31 * 24 * 3_600_000,
  });

  assert.equal(second.asked.length, 1, second.errors);
  assert.deepEqual(second.lines, [], second.errors);
});

test('a page whose free period changes its months, and a page whose discount changes its percent, are each logged as offers changed after a restart', async () => {
  await using data = await mkdtempDisposable(join(tmpdir(), 'credits-data-'));
  const linear = 'https://linear.app/startups';
  const mintlify = 'https://www.mintlify.com/startups';
  const rows = [
    [linear, 'Linear', 'Free Business plan'],
    [mintlify, 'Mintlify', 'Discount on Pro'],
  ] as const;
  const linearPage = (months: number) =>
    ok(`<!doctype html><html><head><title>Linear for Startups</title></head><body>
<main><h1>Linear for Startups</h1><p>Get $2,000 in Linear credits.</p>
<p>The Business plan is free for ${months} months.</p></main></body></html>`);
  const mintlifyPage = (percent: number) =>
    ok(`<!doctype html><html><head><title>Mintlify for Startups</title></head><body>
<main><h1>Mintlify for Startups</h1><p>${percent}% off Mintlify Pro for eligible startups.</p></main></body></html>`);
  const linearOffers = (months: number): Answer => ({
    offers: [
      {
        quote: 'Get $2,000 in Linear credits.',
        kind: 'credits',
        value: { amount: 2_000, currency: 'USD' },
        duration: null,
        who: null,
      },
      {
        quote: `The Business plan is free for ${months} months.`,
        kind: 'free_period',
        months,
        who: null,
      },
    ],
  });
  const mintlifyOffers = (percent: number): Answer => ({
    offers: [
      {
        quote: `${percent}% off Mintlify Pro for eligible startups.`,
        kind: 'discount',
        percent,
        duration: null,
        who: null,
      },
    ],
  });
  const first = await running(data.path, {
    pages: {
      ...lists(rows),
      [linear]: linearPage(6),
      [mintlify]: mintlifyPage(20),
    },
    model: { [linear]: [linearOffers(6)], [mintlify]: [mintlifyOffers(20)] },
    until: (lines) =>
      lines.filter((line) => line.startsWith('new program')).length === 2,
    decisions: programs(linear, mintlify),
    ahead: 0,
  });
  assert.equal(
    first.lines.filter((line) => line.startsWith('new program')).length,
    2,
    `${first.lines.join('\n')}\n${first.errors}`,
  );

  // A month later, when every page is due again.
  const quietLinear = quietAfter(linear, 1);
  const quietMintlify = quietAfter(mintlify, 1);
  const second = await running(data.path, {
    pages: {
      ...lists(rows),
      [linear]: linearPage(3),
      [mintlify]: mintlifyPage(30),
    },
    model: { [linear]: [linearOffers(3)], [mintlify]: [mintlifyOffers(30)] },
    until: (lines, asked) =>
      lines.filter((line) => line.startsWith('offers changed')).length === 2 &&
      quietLinear(lines, asked) &&
      quietMintlify(lines, asked),
    decisions: programs(linear, mintlify),
    ahead: 31 * 24 * 3_600_000,
  });

  assert.deepEqual(
    second.lines.toSorted(),
    [
      `offers changed ${linear}: credits $2,000, free_period 6 months → credits $2,000, free_period 3 months`,
      `offers changed ${mintlify}: discount 20% → discount 30%`,
    ],
    second.errors,
  );
  assert.deepEqual(second.asked.map(({ page }) => page).toSorted(), [
    linear,
    mintlify,
  ]);
});

test('a company page that refuses the crawl is logged as not read, with its address and answer', async () => {
  await using data = await mkdtempDisposable(join(tmpdir(), 'credits-data-'));
  const { lines, errors } = await running(data.path, {
    pages: {
      ...lists([['https://openai.com/startups/', 'OpenAI', 'API credits']]),
      'https://openai.com/startups/': cloudflareChallenge,
    },
    until: has('could not read'),
    decisions: {},
    ahead: 0,
    model: {},
  });

  assert.ok(
    lines.some((line) =>
      line.startsWith(
        'could not read https://openai.com/startups/: Request failed with status code 403',
      ),
    ),
    `${lines.join('\n')}\n${errors}`,
  );
});

test('stopping the app during a model call stores no failure, so the page is still reported when it fails after a restart', async () => {
  await using data = await mkdtempDisposable(join(tmpdir(), 'credits-data-'));
  const aws = 'https://aws.amazon.com/startups/credits';
  const pages = {
    ...lists([[aws, 'AWS', 'Up to $200,000']]),
    [aws]: awsProgram('$200,000'),
  };
  const first = await running(data.path, {
    pages,
    model: { [aws]: [{ hold: true }] },
    until: (_lines, asked) => asked.length === 1,
    decisions: programs(aws),
    ahead: 0,
  });
  assert.equal(first.code, 0, first.errors);
  assert.deepEqual(first.lines, [], first.errors);

  // A failure that the stop stored would be the restart's baseline, and the
  // restart would log nothing for it.
  const failing: Answer = {
    status: 500,
    error: { type: 'api_error', message: 'Internal server error' },
  };
  const second = await running(data.path, {
    pages,
    model: { [aws]: [failing, failing, failing] },
    until: has('could not extract'),
    decisions: programs(aws),
    ahead: 31 * 24 * 3_600_000,
  });

  assert.deepEqual(
    second.lines,
    [`could not extract ${aws}: Internal server error`],
    second.errors,
  );
});

test('a page that Jev labels home or list is not sent to the offer model and logs nothing, a program page whose answer states no offer is logged as a new program with no offer found, and a later answer that states one is logged as offers changed', async () => {
  await using data = await mkdtempDisposable(join(tmpdir(), 'credits-data-'));
  const anthropic = 'https://www.anthropic.com/';
  const directory = 'https://startupsmap.co.in/';
  const microsoft = 'https://www.microsoft.com/en-us/startups';
  const rows = [
    [anthropic, 'Anthropic Startup Program', 'API credits'],
    [directory, 'Startups Map', 'Programs in India'],
    [microsoft, 'Microsoft', 'Up to $150,000'],
  ] as const;
  const decisions = {
    [anthropic]: { kind: 'home' },
    [directory]: { kind: 'list' },
    ...programs(microsoft),
  };
  // startupsmap.co.in, trimmed on 2026-10-31: a directory of programs.
  const directoryPage =
    ok(`<!doctype html><html><head><title>Startups Map</title></head><body>
<main><h1>Startup programs in India</h1><p>Accelerators, incubators and credits for founders, by city.</p></main></body></html>`);
  const first = await running(data.path, {
    pages: {
      ...lists(rows),
      [anthropic]: anthropicHome,
      [directory]: directoryPage,
      [microsoft]: microsoftProgram,
    },
    model: { [microsoft]: [{ offers: [] }] },
    decisions,
    until: has('new program'),
    ahead: 0,
  });
  assert.deepEqual(
    first.lines,
    [`new program ${microsoft}: no offer found`],
    first.errors,
  );
  assert.deepEqual(
    first.asked.map(({ page }) => page),
    [microsoft],
  );
  assert.deepEqual(first.decided.map(({ page }) => page).toSorted(), [
    directory,
    anthropic,
    microsoft,
  ]);

  // A month later the page gains a sentence and the new answer states the
  // credits.
  const second = await running(data.path, {
    pages: {
      ...lists(rows),
      [anthropic]: anthropicHome,
      [directory]: directoryPage,
      [microsoft]: ok(
        microsoftProgram.body.replace(
          '</main>',
          '<p>Join more than 100,000 founders who build on Azure.</p></main>',
        ),
      ),
    },
    model: { [microsoft]: [microsoftOffers] },
    decisions,
    until: has('offers changed'),
    ahead: 31 * 24 * 3_600_000,
  });
  assert.deepEqual(
    second.lines,
    [`offers changed ${microsoft}: none → credits $150,000`],
    second.errors,
  );
});

test('a page that Jev cannot label after the AI SDK retries is logged as could not label, and the other page still reports', async () => {
  await using data = await mkdtempDisposable(join(tmpdir(), 'credits-data-'));
  const aws = 'https://aws.amazon.com/startups/credits';
  const microsoft = 'https://www.microsoft.com/en-us/startups';
  const { lines, decided, errors } = await running(data.path, {
    pages: {
      ...lists([
        [aws, 'AWS', 'Up to $200,000'],
        [microsoft, 'Microsoft', 'Up to $150,000'],
      ]),
      [aws]: awsProgram('$200,000'),
      [microsoft]: microsoftProgram,
    },
    model: { [microsoft]: [microsoftOffers] },
    decisions: {
      [aws]: { status: 429, message: 'Rate limit exceeded' },
      ...programs(microsoft),
    },
    until: (lines) =>
      has('could not label')(lines) && has('new program')(lines),
    ahead: 0,
  });

  assert.deepEqual(
    lines.toSorted(),
    [
      `could not label ${aws}: Rate limit exceeded`,
      `new program ${microsoft}: credits $150,000 ("up to $150,000 in credits")`,
    ],
    errors,
  );
  // A first call and the AI SDK's two retries.
  assert.equal(decided.filter(({ page }) => page === aws).length, 3);
});

test('a 401 from OpenRouter ends the app with the reason, and logs no page as not labelled', async () => {
  await using data = await mkdtempDisposable(join(tmpdir(), 'credits-data-'));
  const aws = 'https://aws.amazon.com/startups/credits';
  const { lines, code, errors } = await running(data.path, {
    pages: {
      ...lists([[aws, 'AWS', 'Up to $200,000']]),
      [aws]: awsProgram('$200,000'),
    },
    model: {},
    // What OpenRouter answered a wrong key on 2026-10-31.
    decisions: { [aws]: { status: 401, message: 'User not found.' } },
    until: () => false,
    ahead: 0,
  });

  assert.notEqual(code, 0, `${lines.join('\n')}\n${errors}`);
  assert.match(errors, /User not found\./u);
  assert.deepEqual(
    lines.filter((line) => line.startsWith('could not label')),
    [],
  );
});
