import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import test from 'node:test';

import { TemporaryFiles } from '@zukhruf/testing/fs';
import { z } from 'zod';

const avinash = 'https://github.com/avinash201199/awesome-startup-credits';
const doanbactam = 'https://github.com/doanbactam/awesome-builder-programs';

// A page with its content type, or a permanent redirect to another address.
type Served = {
  readonly status: number;
  readonly type: string;
  readonly body: string;
};
type Page =
  | Served
  | { readonly status: 301; readonly location: string }
  // A page that never answers, so the pass that requests it keeps running.
  | { readonly hold: true };
const ok = (body: string): Served => ({
  status: 200,
  type: 'text/html; charset=utf-8',
  body,
});
const plain = (body: string): Served => ({
  status: 200,
  type: 'text/plain',
  body,
});

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
const cloudflareChallenge: Served = {
  status: 403,
  type: 'text/html; charset=utf-8',
  body: '<!doctype html><html><head><title>Just a moment...</title></head><body></body></html>',
};

// One planned answer of the Codex Responses endpoint to one request about a
// page: the offers whose quote is in the request (invented ones are sent as
// they are), a raw text, an error status with the body the endpoint sends,
// or no answer until the app stops.
type Answer =
  | {
      readonly offers: readonly Record<string, unknown>[];
      readonly invented?: readonly Record<string, unknown>[];
    }
  | { readonly text: string }
  | { readonly status: number; readonly body: Record<string, unknown> }
  | { readonly hold: true };

// The ChatGPT login of Codex in the app's CODEX_HOME: an access token that
// does not expire before 2100, so the provider asks for no refresh, and the
// account it names.
const account = '5ba1a5a2-6d1e-4c6a-9a51-2f7f0c1d2e3f';
const jwt = (claims: Record<string, unknown>) =>
  [{ alg: 'none', typ: 'JWT' }, claims, 'signature']
    .map((part) =>
      typeof part === 'string'
        ? part
        : Buffer.from(JSON.stringify(part)).toString('base64url'),
    )
    .join('.');
const token = jwt({
  exp: 4_102_444_800,
  'https://api.openai.com/auth': { chatgpt_account_id: account },
});
const codexLogin = JSON.stringify({
  auth_mode: 'chatgpt',
  OPENAI_API_KEY: null,
  tokens: {
    id_token: token,
    access_token: token,
    refresh_token: 'rt_test',
    account_id: account,
  },
  last_refresh: '2026-11-02T00:00:00Z',
});
// The OpenRouter key in the app's environment, which the decision model
// sends.
const openRouterKey = 'sk-or-v1-test-key';

// What OpenRouter's Decisions API answers for each page: the kind that Jev
// chooses, or an error in OpenRouter's error shape, as a 401 for a wrong key
// came on 2026-10-31, at every request about the page.
type Decision =
  | { readonly kind: string }
  | { readonly status: number; readonly message: string };

// What the search model answers to each search, in turn, for a prompt that
// names every criterion of for: the pages that it found, or an error in the
// endpoint's shape.
type Search = { readonly for: readonly string[] } & (
  | {
      readonly pages: readonly {
        readonly url: string;
        readonly company: string;
      }[];
    }
  | { readonly status: number; readonly body: Record<string, unknown> }
);
// What the criterion model answers about one page, for each criterion: its
// verdict, or an error in the endpoint's shape.
type Verdict = {
  readonly quote: string | null;
  readonly meets: boolean;
  readonly reason: string;
};
type Judgement =
  Verdict | { readonly status: number; readonly body: Record<string, unknown> };
type Internet = {
  readonly pages: Readonly<Record<string, Page>>;
  readonly model: Readonly<Record<string, readonly Answer[]>>;
  readonly decisions: Readonly<Record<string, Decision>>;
  readonly searches: readonly Search[];
  readonly verdicts: Readonly<
    Record<string, Readonly<Record<string, Judgement>>>
  >;
  readonly ahead: number;
};

// The internet as the app's process sees it in a test, loaded before
// main.ts: GitHub and the companies' websites answer these pages, every
// robots.txt and sitemap.xml that a test does not give is missing, any other request fails, and each
// request is written to stderr. The Codex Responses endpoint streams the next
// answer planned for each request about a page, in the events of a real
// GPT-6-Luna answer captured on 2026-11-02; OpenRouter's Decisions API answers each
// request about a page with its decision, in the shape of a real Jev 1.14
// answer captured on 2026-10-31. A search, which asks for pages with the
// web_search tool, gets the next planned search, and a verdict, which asks
// whether a page meets a criterion, gets the planned verdict of its page and
// criterion. A request with no planned answer or decision is written to
// stderr as unplanned. The clock runs ahead by the
// given milliseconds, since a test cannot wait a month for the pages to be
// due again.
const internet = ({
  pages,
  model,
  decisions,
  searches,
  verdicts,
  ahead,
}: Internet) => `
import { Msw } from ${JSON.stringify(import.meta.resolve('@zukhruf/testing/msw'))};
import { HttpResponse, http } from ${JSON.stringify(import.meta.resolve('msw'))};
const pages = ${JSON.stringify(pages)};
const planned = ${JSON.stringify(model)};
const decisions = ${JSON.stringify(decisions)};
const searches = ${JSON.stringify(searches)};
const verdicts = ${JSON.stringify(verdicts)};
let searched = 0;
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
// A streamed answer of the Codex Responses endpoint with the given text, in
// the events of a real GPT-6-Luna answer captured on 2026-11-02.
const stream = (model, text) => {
  const id = 'resp_09bbfa0984043937016ae822d27cf08191a424371743d31def';
  const item = { type: 'message', id: 'msg_09bbfa0984043937016ae822d2ead48191aafda124fab9deca', role: 'assistant', phase: 'final_answer' };
  const part = { type: 'output_text', text, annotations: [], logprobs: [] };
  const done = { ...item, status: 'completed', content: [part] };
  const response = (status, output) => ({ id, object: 'response', created_at: 1793598162, status, model, output, error: null, incomplete_details: null, service_tier: 'default' });
  const position = { item_id: item.id, output_index: 0, content_index: 0 };
  const events = [
    { type: 'response.created', response: response('in_progress', []) },
    { type: 'response.in_progress', response: response('in_progress', []) },
    { type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', content: [] } },
    { type: 'response.content_part.added', ...position, part: { ...part, text: '' } },
    { type: 'response.output_text.delta', ...position, delta: text, logprobs: [] },
    { type: 'response.output_text.done', ...position, text },
    { type: 'response.content_part.done', ...position, part },
    { type: 'response.output_item.done', output_index: 0, item: done },
    { type: 'response.completed', response: { ...response('completed', [done]), usage: { input_tokens: 633, input_tokens_details: { cached_tokens: 0 }, output_tokens: 65, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 698 } } },
  ];
  return new HttpResponse(
    events.map((event, sequence_number) => 'event: ' + event.type + '\\ndata: ' + JSON.stringify({ ...event, sequence_number }) + '\\n\\n').join(''),
    { headers: { 'content-type': 'text/event-stream; charset=utf-8' } },
  );
};
const fold = (text) => text.replace(/\\s+/gu, ' ').trim().toLowerCase();
const asked = new Map();
const { server } = new Msw().intercept(
  ...Object.entries(pages).map(([url, page]) =>
    http.get(url, () =>
      'hold' in page
        ? new Promise(() => {})
        : 'location' in page
          ? new HttpResponse(null, { status: page.status, headers: { location: page.location } })
          : new HttpResponse(page.body, { status: page.status, headers: { 'content-type': page.type } }),
    ),
  ),
  http.get('*/robots.txt', () => new HttpResponse(null, { status: 404 })),
  http.get('*/sitemap.xml', () => new HttpResponse(null, { status: 404 })),
  http.post('https://chatgpt.com/backend-api/codex/responses', async ({ request }) => {
    const body = await request.json();
    const prompt = body.input
      .filter(({ role }) => role === 'user')
      .flatMap(({ content }) => typeof content === 'string' ? [content] : content.map(({ text }) => text))
      .join('\\n');
    const page = /^URL: (\\S+)$/mu.exec(prompt)?.[1];
    const properties = body.text?.format?.schema?.properties ?? {};
    // A search asks for pages, with the web_search tool.
    if ('pages' in properties) {
      process.stderr.write('search ' + JSON.stringify({ model: body.model, tools: (body.tools ?? []).map(({ type }) => type), prompt }) + '\\n');
      const answer = searches[searched++];
      if (answer === undefined || !answer.for.every((criterion) => prompt.includes(criterion))) {
        process.stderr.write('unplanned search ' + searched + '\\n');
        return HttpResponse.error();
      }
      if ('status' in answer)
        return HttpResponse.json(answer.body, { status: answer.status, headers: { 'retry-after': '0' } });
      return stream(body.model, JSON.stringify({ pages: answer.pages }));
    }
    // A verdict on one criterion of one page.
    if ('meets' in properties) {
      const criterion = /^Criterion: (.+)$/mu.exec(prompt)?.[1];
      process.stderr.write('verdict ' + JSON.stringify({ page, criterion, model: body.model }) + '\\n');
      const answer = verdicts[page]?.[criterion];
      if (answer === undefined) {
        process.stderr.write('unplanned verdict on ' + criterion + ' for ' + page + '\\n');
        return HttpResponse.error();
      }
      if ('status' in answer)
        return HttpResponse.json(answer.body, { status: answer.status, headers: { 'retry-after': '0' } });
      return stream(body.model, JSON.stringify(answer));
    }
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
      return HttpResponse.json(answer.body, { status: answer.status, headers: { 'retry-after': '0' } });
    const text = 'text' in answer
      ? answer.text
      : JSON.stringify({
          offers: [
            ...answer.offers.filter(({ quote }) => fold(prompt).includes(fold(quote))),
            ...(answer.invented ?? []),
          ],
        });
    return stream(body.model, text);
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
`;

// One request to the Codex Responses endpoint or to the Decisions API, as the internet
// writes it to stderr.
const askedSchema = z.object({
  page: z.string(),
  model: z.string(),
  authorization: z.string(),
});
type Asked = z.infer<typeof askedSchema>;
// One request to the criterion model, and one to the search model.
const judgedSchema = z.object({
  page: z.string(),
  criterion: z.string(),
  model: z.string(),
});
type Judged = z.infer<typeof judgedSchema>;
const searchedSchema = z.object({
  model: z.string(),
  tools: z.array(z.string()),
  prompt: z.string(),
});
type Searched = z.infer<typeof searchedSchema>;

// What ends a run before the app exits or thirty seconds pass, checked on
// each line the app writes: until ends it when it holds; quietAfter ends it
// two seconds after the app's last line once it holds, so a line that the
// last answer causes is logged by then (the app checks its rows every
// second); during ends it when the test's calls to the API end.
type Holds = (
  lines: readonly string[],
  asked: readonly Asked[],
  decided: readonly Asked[],
  judged: readonly Judged[],
  searched: readonly Searched[],
) => boolean;
type End =
  | { readonly until: Holds }
  | { readonly quietAfter: Holds }
  | { readonly during: (app: Serving) => Promise<void> };

// The keys of the API's two consumers, which the app's environment names.
const apiKey = 'sk_credits_test';
const secondKey = 'sk_credits_second';

// The running app as a test calls it: its API, with a consumer's key unless
// the call gives another or none, and a wait that ends two seconds after the
// app's last line once holds is true.
type Serving = {
  readonly api: (
    path: string,
    call?: {
      readonly method?: string;
      readonly body?: unknown;
      readonly key?: string | null;
    },
  ) => Promise<{ readonly status: number; readonly body: unknown }>;
  readonly quiet: (holds: Holds) => Promise<void>;
  readonly requests: readonly string[];
};

// Runs the app with its files in the data folder until end holds, it exits,
// or thirty seconds pass, then stops it as Ctrl-C does. Gives its lines, the URLs it requested, each
// request to the offer model (asked), to the decision model (decided), to the
// criterion model (judged) and to the search model (searched), its exit code
// or the signal that ended it, and stderr. A model request that the test did
// not plan fails the test, and so does a failed call of during.
async function running(
  data: string,
  {
    pages,
    model,
    decisions,
    searches = [],
    verdicts = {},
    ahead,
    ...end
  }: {
    readonly pages: Readonly<Record<string, Page>>;
    readonly model: Readonly<Record<string, readonly Answer[]>>;
    readonly decisions: Readonly<Record<string, Decision>>;
    readonly searches?: Internet['searches'];
    readonly verdicts?: Internet['verdicts'];
    readonly ahead: number;
  } & End,
) {
  await using folder = await new TemporaryFiles().directory('internet-');
  const setup = join(folder.path, 'internet.mjs');
  await writeFile(
    setup,
    internet({ pages, model, decisions, searches, verdicts, ahead }),
  );
  await writeFile(join(folder.path, 'auth.json'), codexLogin, { mode: 0o600 });
  const ended = new AbortController();
  const app = spawn(
    process.execPath,
    ['--import', setup, join(import.meta.dirname, 'main.ts')],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      // Only what the app needs, and none of the developer's logins:
      // XDG_DATA_HOME, the test's own folder, holds the app's files,
      // CODEX_HOME holds the test's ChatGPT login, which the Codex provider
      // reads, the decision model sends OPENROUTER_API_KEY, and the API
      // takes the consumers' keys on any free port.
      env: {
        XDG_DATA_HOME: data,
        CODEX_HOME: folder.path,
        OPENROUTER_API_KEY: openRouterKey,
        STARTUP_CREDITS_API_KEYS: `${apiKey},${secondKey}`,
        PORT: '0',
      },
      signal: AbortSignal.any([ended.signal, AbortSignal.timeout(30_000)]),
      killSignal: 'SIGINT',
    },
  );
  // The abort that stops the app is an error event of its child process.
  const exited = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve, reject) => {
    app.once('exit', (code, signal) => resolve({ code, signal }));
    app.once('error', (error) => {
      if (error.name !== 'AbortError') reject(error);
    });
  });
  const lines: string[] = [];
  const requests: string[] = [];
  const asked: Asked[] = [];
  const decided: Asked[] = [];
  const judged: Judged[] = [];
  const searched: Searched[] = [];
  const unplanned: string[] = [];
  const errors: string[] = [];
  const holds = (given: Holds) =>
    given(lines, asked, decided, judged, searched);
  let quiet: NodeJS.Timeout | undefined;
  const waits: { holds: Holds; resolve: () => void; timer?: NodeJS.Timeout }[] =
    [];
  const check = () => {
    if ('until' in end) {
      if (holds(end.until)) ended.abort();
    } else if ('quietAfter' in end && holds(end.quietAfter)) {
      clearTimeout(quiet);
      quiet = setTimeout(() => ended.abort(), 2_000);
    }
    for (const wait of waits)
      if (holds(wait.holds)) {
        clearTimeout(wait.timer);
        wait.timer = setTimeout(() => {
          waits.splice(waits.indexOf(wait), 1);
          wait.resolve();
        }, 2_000);
      }
  };
  // How the test's calls to the API ended: a run that stops before they end,
  // such as at the thirty seconds, fails the test, as does a failed call.
  const calls: { state: 'waiting' | 'done' | { readonly error: Error } } = {
    state: 'waiting',
  };
  const serve = (base: string) => {
    if (!('during' in end)) return;
    end
      .during({
        api: async (path, call = {}) => {
          const key = call.key === undefined ? apiKey : call.key;
          const response = await fetch(`${base}${path}`, {
            method: call.method ?? 'GET',
            headers: {
              ...(key === null ? {} : { authorization: `Bearer ${key}` }),
              ...(call.body === undefined
                ? {}
                : { 'content-type': 'application/json' }),
            },
            body:
              call.body === undefined ? undefined : JSON.stringify(call.body),
          });
          const text = await response.text();
          return {
            status: response.status,
            body: response.headers
              .get('content-type')
              ?.startsWith('application/json')
              ? JSON.parse(text)
              : text,
          };
        },
        quiet: (given) =>
          new Promise<void>((resolve) => {
            waits.push({ holds: given, resolve });
            check();
          }),
        requests,
      })
      .then(
        () => {
          calls.state = 'done';
          ended.abort();
        },
        (error: unknown) => {
          calls.state = {
            error: Error.isError(error) ? error : new Error(String(error)),
          };
          ended.abort();
        },
      );
  };
  createInterface({ input: app.stdout }).on('line', (line) => {
    // The API's address is not one of the app's alert lines.
    const api = /^API on (http:\/\/localhost:\d+)$/u.exec(line)?.[1];
    if (api === undefined) lines.push(line);
    else serve(api);
    check();
  });
  createInterface({ input: app.stderr }).on('line', (line) => {
    if (line.startsWith('request '))
      requests.push(line.slice('request '.length));
    else if (line.startsWith('model '))
      asked.push(askedSchema.parse(JSON.parse(line.slice('model '.length))));
    else if (line.startsWith('decision '))
      decided.push(
        askedSchema.parse(JSON.parse(line.slice('decision '.length))),
      );
    else if (line.startsWith('verdict '))
      judged.push(
        judgedSchema.parse(JSON.parse(line.slice('verdict '.length))),
      );
    else if (line.startsWith('search '))
      searched.push(
        searchedSchema.parse(JSON.parse(line.slice('search '.length))),
      );
    else if (line.startsWith('unplanned ')) unplanned.push(line);
    else errors.push(line);
    check();
  });
  const { code, signal } = await exited;
  clearTimeout(quiet);
  for (const wait of waits) clearTimeout(wait.timer);
  if ('during' in end && calls.state === 'waiting')
    assert.fail(
      [
        'The app stopped before the calls to its API ended.',
        `lines: ${JSON.stringify(lines)}`,
        `last requests: ${JSON.stringify(requests.slice(-8))}`,
        ...errors,
      ].join('\n'),
    );
  if (typeof calls.state === 'object') throw calls.state.error;
  assert.deepEqual(unplanned, [], errors.join('\n'));
  return {
    lines,
    requests,
    asked,
    decided,
    judged,
    searched,
    code,
    signal,
    errors: errors.join('\n'),
  };
}

// Jev labels each of these pages program.
const programs = (...pages: readonly string[]) =>
  Object.fromEntries(pages.map((page) => [page, { kind: 'program' }]));

const has = (prefix: string) => (lines: readonly string[]) =>
  lines.some((line) => line.startsWith(prefix));

// True once the model was asked about the page the given number of times.
const askedAbout =
  (page: string, calls: number) =>
  (_lines: readonly string[], asked: readonly Asked[]) =>
    asked.filter((call) => call.page === page).length >= calls;

test('a 401 from the model ends the app with the reason, and logs no page as not extracted', async () => {
  await using data = await new TemporaryFiles().directory('credits-data-');
  // The body of a real 401 of the Codex Responses endpoint, captured on
  // 2026-11-02.
  const rejected: Answer = {
    status: 401,
    body: {
      detail:
        'Could not parse your authentication token. Please try signing in again.',
    },
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
  assert.match(errors, /Could not parse your authentication token/u);
  assert.deepEqual(
    lines.filter((line) => line.startsWith('could not extract')),
    [],
  );
});

test('a page whose model calls stay rate limited after the AI SDK retries is logged as could not extract once, also when it fails again after a restart, the other page still reports, and a later pass that succeeds reports the page', async () => {
  await using data = await new TemporaryFiles().directory('credits-data-');
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
  // The body of the 429 that the Codex Responses endpoint sends when the
  // plan's limit is used up, as the Codex CLI parses it
  // (openai/codex codex-rs/codex-api/src/api_bridge.rs at 5a7353f040).
  const limited: Answer = {
    status: 429,
    body: {
      error: {
        type: 'usage_limit_reached',
        plan_type: 'pro',
        resets_at: 1_794_125_699,
        limit_window_minutes: 10_080,
      },
    },
  };
  // The Codex CLI retries a 503 server_is_overloaded.
  const overloaded: Answer = {
    status: 503,
    body: { error: { type: 'server_is_overloaded' } },
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
      // The body has no message, so the provider gives the status text.
      `could not extract ${aws}: Too Many Requests`,
      `new program ${microsoft}: credits $150,000 ("Access cutting-edge AI models, developer tools, and up to $150,000 in credits, backed by Microsoft’s global customer network.")`,
    ],
    first.errors,
  );

  // A month later the failed page is asked again and fails for another
  // reason.
  const second = await running(data.path, {
    pages,
    model: { [aws]: [overloaded, overloaded, overloaded] },
    quietAfter: askedAbout(aws, 3),
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
  await using data = await new TemporaryFiles().directory('credits-data-');
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
  await using data = await new TemporaryFiles().directory('credits-data-');
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
  await using data = await new TemporaryFiles().directory('credits-data-');
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

test('a program page is logged as a new program with the kind, value and quote of each offer, Jev 1.14 labels it through OpenRouter with the key, the offer model gets the whole page from GPT-6-Luna with the ChatGPT login, and no other page of GitHub is requested', async () => {
  await using data = await new TemporaryFiles().directory('credits-data-');
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
    { page: ovh, model: 'gpt-6-luna', authorization: `Bearer ${token}` },
  ]);
  assert.deepEqual(decided, [
    {
      page: ovh,
      model: 'typesafe/jev-1.14',
      authorization: `Bearer ${openRouterKey}`,
    },
  ]);
  // Each list is a crawl of its own, which reads robots.txt itself and,
  // when robots.txt names no sitemap, guesses /sitemap.xml. The program is
  // reported while the crawl goes on, so the second list may not be read yet.
  const github = new Set([
    avinash,
    doanbactam,
    'https://github.com/robots.txt',
    'https://github.com/sitemap.xml',
  ]);
  assert.deepEqual(
    requests.filter(
      (url) => new URL(url).hostname === 'github.com' && !github.has(url),
    ),
    [],
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
  await using data = await new TemporaryFiles().directory('credits-data-');
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
    quietAfter: (lines, asked) =>
      has('offers changed')(lines) && askedAbout(aws, 1)(lines, asked),
    decisions: programs(aws, microsoft),
    ahead: 31 * 24 * 3_600_000,
  });

  assert.deepEqual(
    second.lines,
    [
      `offers changed ${aws}: credits $100,000, credits $5,000, free_period 3 months`,
    ],
    second.errors,
  );
  assert.deepEqual(
    second.asked.map(({ page }) => page),
    [aws],
  );
});

test('a page whose text changes outside its offers, and whose new answer quotes the same offers in other words, logs nothing after a restart', async () => {
  await using data = await new TemporaryFiles().directory('credits-data-');
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
    quietAfter: askedAbout(microsoft, 1),
    decisions: programs(microsoft),
    ahead: 31 * 24 * 3_600_000,
  });

  assert.equal(second.asked.length, 1, second.errors);
  assert.deepEqual(second.lines, [], second.errors);
});

test('a page whose text changes, and whose new answer adds an offer with no value and quotes its free period in other words, logs nothing after a restart', async () => {
  await using data = await new TemporaryFiles().directory('credits-data-');
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
    quietAfter: askedAbout(notion, 1),
    decisions: programs(notion),
    ahead: 31 * 24 * 3_600_000,
  });

  assert.equal(second.asked.length, 1, second.errors);
  assert.deepEqual(second.lines, [], second.errors);
});

test('a page whose free period changes its months, and a page whose discount changes its percent, are each logged as offers changed after a restart', async () => {
  await using data = await new TemporaryFiles().directory('credits-data-');
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
  const second = await running(data.path, {
    pages: {
      ...lists(rows),
      [linear]: linearPage(3),
      [mintlify]: mintlifyPage(30),
    },
    model: { [linear]: [linearOffers(3)], [mintlify]: [mintlifyOffers(30)] },
    quietAfter: (lines, asked) =>
      lines.filter((line) => line.startsWith('offers changed')).length === 2 &&
      askedAbout(linear, 1)(lines, asked) &&
      askedAbout(mintlify, 1)(lines, asked),
    decisions: programs(linear, mintlify),
    ahead: 31 * 24 * 3_600_000,
  });

  assert.deepEqual(
    second.lines.toSorted(),
    [
      `offers changed ${linear}: credits $2,000, free_period 3 months`,
      `offers changed ${mintlify}: discount 30%`,
    ],
    second.errors,
  );
  assert.deepEqual(second.asked.map(({ page }) => page).toSorted(), [
    linear,
    mintlify,
  ]);
});

test('a fee waiver that the answer states as a 0% discount is logged as a discount with no percent, and a later answer that states it with no percent logs nothing after a restart', async () => {
  await using data = await new TemporaryFiles().directory('credits-data-');
  const openrouter = 'https://openrouter.ai/startup-program';
  const rows = [[openrouter, 'OpenRouter', 'Inference credits']] as const;
  // openrouter.ai/startup-program, trimmed on 2026-10-30.
  const page = (more: string) =>
    ok(`<!doctype html><html><head><title>Startup Program | OpenRouter</title></head><body>
<main><h1>OpenRouter for Startups</h1><p>One API. Every Model. Zero Lock-In.</p>
<p>Eligible startups get up to $5,000 in universal inference credits usable across leading frontier and open models with 0% processing fees.</p>${more}
<h2>What is the offer worth?</h2>
<p>Eligible startups can receive up to $5,000 in universal inference credits, usable across 600+ models available on OpenRouter, along with 0% processing fees for 12 months (including both platform fees and BYOK fees).</p></main></body></html>`);
  const credits = {
    quote:
      'Eligible startups get up to $5,000 in universal inference credits usable across leading frontier and open models with 0% processing fees.',
    kind: 'credits',
    value: { amount: 5_000, currency: 'USD' },
    duration: null,
    who: 'Eligible startups',
  };
  const waiver = {
    quote:
      'Eligible startups can receive up to $5,000 in universal inference credits, usable across 600+ models available on OpenRouter, along with 0% processing fees for 12 months (including both platform fees and BYOK fees).',
    kind: 'discount',
    duration: '12 months',
    who: 'Eligible startups',
    value: null,
  };
  // Haiku 5.5's answer for the page on both eval runs of 2026-10-31.
  const first = await running(data.path, {
    pages: { ...lists(rows), [openrouter]: page('') },
    model: { [openrouter]: [{ offers: [credits, { ...waiver, percent: 0 }] }] },
    until: has('new program'),
    decisions: programs(openrouter),
    ahead: 0,
  });
  assert.deepEqual(
    first.lines,
    [
      `new program ${openrouter}: credits $5,000 ("${credits.quote}"); discount ("${waiver.quote}")`,
    ],
    first.errors,
  );

  // A month later the page gains a sentence, and the new answer states the
  // waiver with no percent, as answers of the earlier prompt did on one of
  // two runs (#3481).
  const second = await running(data.path, {
    pages: {
      ...lists(rows),
      [openrouter]: page(
        '\n<p>Pay only for the tokens you use. No platform markup.</p>',
      ),
    },
    model: {
      [openrouter]: [{ offers: [credits, { ...waiver, percent: null }] }],
    },
    quietAfter: askedAbout(openrouter, 1),
    decisions: programs(openrouter),
    ahead: 31 * 24 * 3_600_000,
  });

  assert.equal(second.asked.length, 1, second.errors);
  assert.deepEqual(second.lines, [], second.errors);
});

test('a company page that refuses the crawl is logged as not read, with its address and answer, and its program is not logged as missing, as no page of it was read', async () => {
  await using data = await new TemporaryFiles().directory('credits-data-');
  const { lines, errors } = await running(data.path, {
    pages: {
      ...lists([['https://openai.com/startups/', 'OpenAI', 'API credits']]),
      'https://openai.com/startups/': cloudflareChallenge,
    },
    // Two seconds after the line, so a missing line would be logged by then.
    quietAfter: has('could not read'),
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
  assert.deepEqual(
    lines.filter((line) => line.includes('no program page found')),
    [],
  );
});

test('stopping the app during a model call stores no failure, so the page is still reported when it fails after a restart', async () => {
  await using data = await new TemporaryFiles().directory('credits-data-');
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
  // The stop ends the app by its signal, as a Ctrl-C in a shell does.
  assert.deepEqual(
    { code: first.code, signal: first.signal },
    { code: null, signal: 'SIGINT' },
    first.errors,
  );
  assert.deepEqual(first.lines, [], first.errors);

  // A failure that the stop stored would be the restart's baseline, and the
  // restart would log nothing for it.
  const failing: Answer = {
    status: 500,
    body: { error: { message: 'Internal server error', type: 'server_error' } },
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

test('a page that Jev labels home or list is not sent to the offer model, and the program that the list names for it is logged as no program page found, a program page whose answer states no offer is logged as a new program with no offer found, and a later answer that states one is logged as offers changed', async () => {
  await using data = await new TemporaryFiles().directory('credits-data-');
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
    until: (lines) =>
      has('new program')(lines) &&
      lines.filter((line) => line.includes('no program page found')).length ===
        2,
    ahead: 0,
  });
  assert.deepEqual(
    first.lines.toSorted(),
    [
      `Anthropic Startup Program: no program page found (${anthropic} linked by ${avinash})`,
      `Startups Map: no program page found (${directory} linked by ${avinash})`,
      `new program ${microsoft}: no offer found`,
    ],
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
    [`offers changed ${microsoft}: credits $150,000`],
    second.errors,
  );
});

test('a page that Jev cannot label after the AI SDK retries is logged as could not label, and the other page still reports', async () => {
  await using data = await new TemporaryFiles().directory('credits-data-');
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
  await using data = await new TemporaryFiles().directory('credits-data-');
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

test('a program that a list names and whose page Jev labels home is logged as no program page found, with its name, link and list', async () => {
  await using data = await new TemporaryFiles().directory('credits-data-');
  const anthropic = 'https://www.anthropic.com/';
  const { lines, errors } = await running(data.path, {
    pages: {
      ...lists([[anthropic, 'Anthropic Startup Program', 'API credits']]),
      [anthropic]: anthropicHome,
    },
    model: {},
    decisions: { [anthropic]: { kind: 'home' } },
    until: has('Anthropic Startup Program: no program page found'),
    ahead: 0,
  });

  assert.deepEqual(
    lines,
    [
      `Anthropic Startup Program: no program page found (${anthropic} linked by ${avinash})`,
    ],
    errors,
  );
});

// claude.com/programs/startups, trimmed on 2026-10-31.
const claudeProgram =
  ok(`<!doctype html><html><head><title>Claude for Startups</title></head><body>
<main><h1>Claude for Startups</h1><p>Access discounts and credits worth up to $45,000 from companies building with Claude.</p></main></body></html>`);
const claudeOffers: Answer = {
  offers: [
    {
      quote:
        'Access discounts and credits worth up to $45,000 from companies building with Claude.',
      kind: 'credits',
      value: { amount: 45_000, currency: 'USD' },
      duration: null,
      who: null,
    },
  ],
};

test('a program whose list links a page that gives no text, such as a page that only a script fills, is logged as no program page found once the crawl of the list is complete', async () => {
  await using data = await new TemporaryFiles().directory('credits-data-');
  const linear = 'https://linear.app/startups';
  // A page that a script renders, as Vite's index.html is: the crawler runs
  // no script, so the page holds no text to store or label.
  const shell =
    ok(`<!doctype html><html><head><title>Linear</title></head><body>
<div id="root"></div><script type="module" src="/assets/index.js"></script></body></html>`);
  const { lines, decided, errors } = await running(data.path, {
    pages: {
      ...lists([[linear, 'Linear', 'Free Business plan']]),
      [linear]: shell,
    },
    model: {},
    decisions: {},
    until: has('Linear: no program page found'),
    ahead: 0,
  });

  assert.deepEqual(
    lines,
    [`Linear: no program page found (${linear} linked by ${avinash})`],
    errors,
  );
  assert.deepEqual(decided, []);
});

test('a program whose name another list gives to a program page on another website is not logged as missing', async () => {
  await using data = await new TemporaryFiles().directory('credits-data-');
  const anthropic = 'https://www.anthropic.com/';
  const claude = 'https://claude.com/programs/startups';
  // Both lists as they link Anthropic's program on 2026-10-31.
  const { lines, errors } = await running(data.path, {
    pages: {
      [avinash]: githubList('/avinash201199/awesome-startup-credits', [
        [
          anthropic,
          'Anthropic Startup Program',
          '$25K–$100K+ Claude API credits',
        ],
      ]),
      [doanbactam]: githubList('/doanbactam/awesome-builder-programs', [
        [claude, 'Anthropic Startup Program', 'API credits'],
      ]),
      [anthropic]: anthropicHome,
      [claude]: claudeProgram,
    },
    model: { [claude]: [claudeOffers] },
    decisions: { [anthropic]: { kind: 'home' }, ...programs(claude) },
    // Two seconds after the new program, so a missing line would be logged
    // by then.
    quietAfter: has('new program'),
    ahead: 0,
  });

  assert.deepEqual(
    lines,
    [
      `new program ${claude}: credits $45,000 ("Access discounts and credits worth up to $45,000 from companies building with Claude.")`,
    ],
    errors,
  );
});

test('a program whose link shares its registrable domain with a program page is not logged as missing', async () => {
  await using data = await new TemporaryFiles().directory('credits-data-');
  const home = 'https://vercel.com/';
  const startups = 'https://vercel.com/startups';
  const { lines, errors } = await running(data.path, {
    pages: {
      ...lists([
        [home, 'Vercel', 'Credits + AI Accelerator'],
        [startups, 'Vercel Startups', 'Hosting credits'],
      ]),
      // vercel.com, trimmed on 2026-10-31: enough text for a page record.
      [home]:
        ok(`<!doctype html><html><head><title>Vercel: Build and deploy the best web experiences with the AI Cloud</title></head><body>
<main><h1>Build and deploy on the AI Cloud.</h1>
<p>Vercel provides the developer tools and cloud infrastructure to build, scale, and secure a faster, more personalized web.</p></main></body></html>`),
      [startups]:
        ok(`<!doctype html><html><head><title>Vercel for Startups</title></head><body>
<main><h1>Vercel for Startups</h1><p>Eligible teams get up to $30,000 in credits for their first year.</p></main></body></html>`),
    },
    model: {
      [startups]: [
        {
          offers: [
            {
              quote:
                'Eligible teams get up to $30,000 in credits for their first year.',
              kind: 'credits',
              value: { amount: 30_000, currency: 'USD' },
              duration: null,
              who: null,
            },
          ],
        },
      ],
    },
    decisions: { [home]: { kind: 'home' }, ...programs(startups) },
    quietAfter: has('new program'),
    ahead: 0,
  });

  assert.deepEqual(
    lines,
    [
      `new program ${startups}: credits $30,000 ("Eligible teams get up to $30,000 in credits for their first year.")`,
    ],
    errors,
  );
});

test('a list that redirects to its new address, as a renamed GitHub repository does, still names its programs', async () => {
  await using data = await new TemporaryFiles().directory('credits-data-');
  const anthropic = 'https://www.anthropic.com/';
  const renamed = 'https://github.com/avinash201199/startup-credits';
  const { lines, errors } = await running(data.path, {
    pages: {
      [avinash]: { status: 301, location: renamed },
      [renamed]: githubList('/avinash201199/startup-credits', [
        [anthropic, 'Anthropic Startup Program', 'API credits'],
      ]),
      [doanbactam]: githubList('/doanbactam/awesome-builder-programs', []),
      [anthropic]: anthropicHome,
    },
    model: {},
    decisions: { [anthropic]: { kind: 'home' } },
    until: has('Anthropic Startup Program: no program page found'),
    ahead: 0,
  });

  assert.deepEqual(
    lines,
    [
      `Anthropic Startup Program: no program page found (${anthropic} linked by ${avinash})`,
    ],
    errors,
  );
});

// vercel.com, trimmed on 2026-10-31: its menu links the program and a page
// that is no program; its robots.txt names a sitemap.
const vercelHome =
  ok(`<!doctype html><html><head><title>Vercel: Build and deploy the best web experiences with the AI Cloud</title></head><body>
<nav><a href="/startups">Startups</a><a href="/pricing">Pricing</a></nav>
<main><h1>Build and deploy on the AI Cloud.</h1>
<p>Vercel provides the developer tools and cloud infrastructure to build, scale, and secure a faster, more personalized web.</p></main></body></html>`);
const vercelStartups =
  ok(`<!doctype html><html><head><title>Vercel for Startups</title></head><body>
<main><h1>Vercel for Startups</h1><p>Eligible teams get up to $30,000 in credits for their first year.</p></main></body></html>`);
const vercelCredits: Answer = {
  offers: [
    {
      quote:
        'Eligible teams get up to $30,000 in credits for their first year.',
      kind: 'credits',
      value: { amount: 30_000, currency: 'USD' },
      duration: null,
      who: null,
    },
  ],
};

test('a home page that a list links is searched one step, so the program page that its menu links is reported and the program is not missing, a link that matches no expand pattern is not requested, and a sitemap that its robots.txt names but that does not load is not logged', async () => {
  await using data = await new TemporaryFiles().directory('credits-data-');
  const home = 'https://vercel.com/';
  const startups = 'https://vercel.com/startups';
  const broken = 'https://vercel.com/broken-sitemap.xml';
  const { lines, requests, errors } = await running(data.path, {
    pages: {
      ...lists([[home, 'Vercel', 'Credits + AI Accelerator']]),
      [home]: vercelHome,
      [startups]: vercelStartups,
      'https://vercel.com/robots.txt': plain(
        `User-agent: *\nAllow: /\nSitemap: ${broken}\n`,
      ),
      [broken]: { status: 500, type: 'text/plain', body: 'Server error' },
    },
    model: { [startups]: [vercelCredits] },
    decisions: { [home]: { kind: 'home' }, ...programs(startups) },
    // The offers come after the pass, so its failures are logged by then;
    // two seconds more for a missing line.
    quietAfter: has('new program'),
    ahead: 0,
  });

  assert.deepEqual(
    lines,
    [
      `new program ${startups}: credits $30,000 ("Eligible teams get up to $30,000 in credits for their first year.")`,
    ],
    errors,
  );
  assert.ok(requests.includes(broken), errors);
  assert.ok(!requests.includes('https://vercel.com/pricing'), errors);
});

test('the search inside a linked website keeps a page whose last path segment names startups, such as /startups, /hubspot-for-startups-for-education or /startup-program/, and requests no page under a startup section, such as its blog or its events', async () => {
  await using data = await new TemporaryFiles().directory('credits-data-');
  const home = 'https://www.hubspot.com/';
  const startups = 'https://www.hubspot.com/startups';
  const education =
    'https://www.hubspot.com/hubspot-for-startups-for-education';
  const blog = 'https://www.hubspot.com/startups/blog';
  const events = 'https://www.hubspot.com/startups/community/events';
  const sitemap = 'https://www.hubspot.com/sitemap-startups.xml';
  const neo4j = 'https://neo4j.com/';
  const neo4jProgram = 'https://neo4j.com/startup-program/';
  const neo4jSitemap = 'https://neo4j.com/sitemap.xml';
  const offer =
    'Eligible startups get up to 90% off HubSpot software in year one.';
  const { lines, requests, errors } = await running(data.path, {
    pages: {
      ...lists([
        [home, 'HubSpot', 'Discount on HubSpot'],
        [neo4j, 'Neo4j', 'Startup program'],
      ]),
      [home]:
        ok(`<!doctype html><html><head><title>HubSpot | Software and Tools for your Business</title></head><body>
<main><h1>Grow better with HubSpot</h1><p>HubSpot is an AI-powered customer platform with the software, integrations and resources you need to connect marketing, sales and service.</p></main></body></html>`),
      'https://www.hubspot.com/robots.txt': plain(
        `User-agent: *\nAllow: /\nSitemap: ${sitemap}\n`,
      ),
      // The startup pages of the sitemap, as the acceptance test of
      // 2026-11-01 found them.
      [sitemap]: {
        status: 200,
        type: 'application/xml',
        body: `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[startups, education, blog, events].map((url) => `<url><loc>${url}</loc></url>`).join('')}</urlset>`,
      },
      [startups]:
        ok(`<!doctype html><html><head><title>HubSpot for Startups</title></head><body>
<main><h1>HubSpot for Startups</h1><p>${offer}</p></main></body></html>`),
      [education]:
        ok(`<!doctype html><html><head><title>HubSpot for Startups for Education</title></head><body>
<main><h1>HubSpot for Startups for Education</h1><p>Universities and accelerators that teach entrepreneurship can bring HubSpot into their programs.</p></main></body></html>`),
      [blog]:
        ok(`<!doctype html><html><head><title>HubSpot for Startups Blog</title></head><body>
<main><h1>The HubSpot for Startups blog</h1><p>Stories, playbooks and advice for founders who build and scale a startup.</p></main></body></html>`),
      [events]:
        ok(`<!doctype html><html><head><title>Startup events | HubSpot</title></head><body>
<main><h1>Events for startups</h1><p>Meet other founders at HubSpot for Startups events around the world.</p></main></body></html>`),
      [neo4j]:
        ok(`<!doctype html><html><head><title>Neo4j Graph Database & Analytics</title></head><body>
<main><h1>The graph database for connected data</h1><p>Neo4j helps developers build intelligent applications on connected data.</p></main></body></html>`),
      'https://neo4j.com/robots.txt': plain(
        `User-agent: *\nAllow: /\nSitemap: ${neo4jSitemap}\n`,
      ),
      [neo4jSitemap]: {
        status: 200,
        type: 'application/xml',
        body: `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${neo4jProgram}</loc></url></urlset>`,
      },
      [neo4jProgram]:
        ok(`<!doctype html><html><head><title>Neo4j Startup Program</title></head><body>
<main><h1>Neo4j Startup Program</h1><p>Early-stage companies can build on Neo4j with help from our startup team.</p></main></body></html>`),
    },
    model: {
      [startups]: [
        {
          offers: [
            {
              quote: offer,
              kind: 'discount',
              percent: 90,
              duration: 'year one',
              who: 'Eligible startups',
              value: null,
            },
          ],
        },
      ],
      [education]: [{ offers: [] }],
      [neo4jProgram]: [{ offers: [] }],
    },
    decisions: {
      [home]: { kind: 'home' },
      [neo4j]: { kind: 'home' },
      ...programs(startups, education, neo4jProgram),
    },
    quietAfter: (lines) =>
      lines.filter((line) => line.startsWith('new program')).length === 3,
    ahead: 0,
  });

  assert.deepEqual(
    lines.toSorted(),
    [
      `new program ${neo4jProgram}: no offer found`,
      `new program ${education}: no offer found`,
      `new program ${startups}: discount 90% ("${offer}")`,
    ],
    errors,
  );
  assert.deepEqual(
    requests.filter((url) => url === blog || url === events),
    [],
  );
});

test("a partner's program page that a home page links on another website is reported, and does not stand for the program that the list names", async () => {
  await using data = await new TemporaryFiles().directory('credits-data-');
  const home = 'https://vercel.com/';
  // AWS's program page: the search inside a linked website keeps a page
  // whose last path segment names startups.
  const partner = 'https://aws.amazon.com/startups';
  const { lines, errors } = await running(data.path, {
    pages: {
      ...lists([[home, 'Vercel', 'Credits + AI Accelerator']]),
      [home]:
        ok(`<!doctype html><html><head><title>Vercel: Build and deploy the best web experiences with the AI Cloud</title></head><body>
<nav><a href="${partner}">AWS Activate credits for our customers</a></nav>
<main><h1>Build and deploy on the AI Cloud.</h1>
<p>Vercel provides the developer tools and cloud infrastructure to build, scale, and secure a faster, more personalized web.</p></main></body></html>`),
      [partner]: awsProgram('$200,000'),
    },
    model: {
      [partner]: [
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
        },
      ],
    },
    decisions: { [home]: { kind: 'home' }, ...programs(partner) },
    quietAfter: (lines) =>
      has('new program')(lines) && has('Vercel: no program page found')(lines),
    ahead: 0,
  });

  assert.deepEqual(
    lines.toSorted(),
    [
      `Vercel: no program page found (${home} linked by ${avinash})`,
      `new program ${partner}: credits $5,000 ("Up to $5,000 USD in Activate Credits")`,
    ],
    errors,
  );
});

test('a program whose list link redirects to the company page that Jev labels home is logged as no program page found, with the link the list gives', async () => {
  await using data = await new TemporaryFiles().directory('credits-data-');
  const linked = 'https://anthropic.com/';
  const home = 'https://www.anthropic.com/';
  const { lines, errors } = await running(data.path, {
    pages: {
      ...lists([[linked, 'Anthropic Startup Program', 'API credits']]),
      [linked]: { status: 301, location: home },
      [home]: anthropicHome,
    },
    model: {},
    decisions: { [home]: { kind: 'home' } },
    until: has('Anthropic Startup Program: no program page found'),
    ahead: 0,
  });

  assert.deepEqual(
    lines,
    [
      `Anthropic Startup Program: no program page found (${linked} linked by ${avinash})`,
    ],
    errors,
  );
});

// A page in one language, as aws.amazon.com/de/training/startups/ declared
// its copies on 2026-11-02: in its head, an hreflang link for each copy that
// it names, itself included, and a language menu that links the copies.
const localized = (
  title: string,
  text: string,
  head: readonly (readonly [string, string])[],
  menu: readonly string[] = head.map(([, url]) => url),
) =>
  ok(`<!doctype html><html><head><title>${title}</title>
${head.map(([language, url]) => `<link rel="alternate" hreflang="${language}" href="${url}">`).join('\n')}
</head><body><nav>${menu.map((url) => `<a href="${url}">${url}</a>`).join('')}</nav>
<main><h1>${title}</h1><p>${text}</p></main></body></html>`);

const trainingOffer =
  'Startups can get up to $10,000 in AWS credits for training.';
const trainingCredits: Answer = {
  offers: [
    {
      quote: trainingOffer,
      kind: 'credits',
      value: { amount: 10_000, currency: 'USD' },
      duration: null,
      who: null,
    },
  ],
};

test('a page and its German copy, which each declare the other, go to Jev and to the offer model once, as the English copy, and the program is logged once', async () => {
  await using data = await new TemporaryFiles().directory('credits-data-');
  const english = 'https://aws.amazon.com/training/startups/';
  const german = 'https://aws.amazon.com/de/training/startups/';
  const copies = [
    ['en-us', english],
    ['de-de', german],
  ] as const;
  const { lines, requests, asked, decided, errors } = await running(data.path, {
    pages: {
      ...lists([[english, 'AWS Training', 'Credits for training']]),
      [english]: localized('AWS Training for Startups', trainingOffer, copies),
      [german]: localized(
        'AWS Schulungen für Startups',
        'Startups erhalten bis zu 10.000 USD in AWS-Gutschriften für Schulungen.',
        copies,
      ),
    },
    model: { [english]: [trainingCredits] },
    decisions: programs(english),
    quietAfter: has('new program'),
    ahead: 0,
  });

  assert.deepEqual(
    lines,
    [`new program ${english}: credits $10,000 ("${trainingOffer}")`],
    errors,
  );
  assert.ok(requests.includes(german), errors);
  assert.deepEqual(
    decided.map(({ page }) => page),
    [english],
  );
  assert.deepEqual(
    asked.map(({ page }) => page),
    [english],
  );
});

test('of the copies that declare each other, the x-default one goes to the models, else an English one, also when another URL is smaller, else the smallest URL, whatever order a page declares them in', async () => {
  await using data = await new TemporaryFiles().directory('credits-data-');
  const stripe = 'https://stripe.com/startups';
  const stripeCopies = [
    ['x-default', stripe],
    ['en-gb', 'https://stripe.com/gb/startups'],
    ['de', 'https://stripe.com/de/startups'],
  ] as const;
  const aws = 'https://aws.amazon.com/training/startups/';
  const awsCopies = [
    ['en-us', aws],
    ['de-de', 'https://aws.amazon.com/de/training/startups/'],
    ['ja-jp', 'https://aws.amazon.com/ja/training/startups/'],
  ] as const;
  const notion = 'https://www.notion.com/de-de/startups';
  const notionCopies = [
    ['ja-jp', 'https://www.notion.com/ja-jp/startups'],
    ['fr-fr', 'https://www.notion.com/fr-fr/startups'],
    ['de-de', notion],
  ] as const;
  const page = (copies: readonly (readonly [string, string])[]) =>
    Object.fromEntries(
      copies.map(([language, url]) => [
        url,
        localized(
          `Startups (${language})`,
          `Our startup program in ${language}.`,
          copies,
        ),
      ]),
    );
  const { lines, decided, errors } = await running(data.path, {
    pages: {
      ...lists([
        [stripe, 'Stripe', 'Discount'],
        [aws, 'AWS Training', 'Credits for training'],
        [notion, 'Notion', 'Free months'],
      ]),
      ...page(stripeCopies),
      ...page(awsCopies),
      ...page(notionCopies),
    },
    model: Object.fromEntries(
      [stripe, aws, notion].map((url) => [url, [{ offers: [] }]]),
    ),
    decisions: programs(stripe, aws, notion),
    quietAfter: (lines) =>
      lines.filter((line) => line.startsWith('new program')).length === 3,
    ahead: 0,
  });

  assert.deepEqual(
    lines.toSorted(),
    [
      `new program ${aws}: no offer found`,
      `new program ${stripe}: no offer found`,
      `new program ${notion}: no offer found`,
    ],
    errors,
  );
  assert.deepEqual(decided.map(({ page }) => page).toSorted(), [
    aws,
    stripe,
    notion,
  ]);
});

test("copies that a page's head and a sitemap's xhtml:link declare between them are one group, though neither declaration alone names both ways", async () => {
  await using data = await new TemporaryFiles().directory('credits-data-');
  const home = 'https://www.hubspot.com/';
  const english = 'https://www.hubspot.com/startups';
  const german = 'https://www.hubspot.com/de/startups';
  const sitemap = 'https://www.hubspot.com/sitemap-startups.xml';
  const { lines, requests, decided, errors } = await running(data.path, {
    pages: {
      ...lists([[home, 'HubSpot', 'Discount on HubSpot']]),
      [home]:
        ok(`<!doctype html><html><head><title>HubSpot | Software and Tools for your Business</title></head><body>
<main><h1>Grow better with HubSpot</h1><p>HubSpot is an AI-powered customer platform with the software, integrations and resources you need to connect marketing, sales and service.</p></main></body></html>`),
      'https://www.hubspot.com/robots.txt': plain(
        `User-agent: *\nAllow: /\nSitemap: ${sitemap}\n`,
      ),
      // The English page first, then its German copy, which only the
      // sitemap says is a copy of the English page.
      [sitemap]: {
        status: 200,
        type: 'application/xml',
        body: `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml"><url><loc>${english}</loc></url><url><loc>${german}</loc><xhtml:link rel="alternate" hreflang="en" href="${english}"/></url></urlset>`,
      },
      [english]: localized(
        'HubSpot for Startups',
        'Eligible startups get HubSpot software at a discount.',
        [
          ['en', english],
          ['de', german],
        ],
        [],
      ),
      [german]: localized(
        'HubSpot für Startups',
        'Berechtigte Startups erhalten HubSpot-Software mit Rabatt.',
        [],
      ),
    },
    model: { [english]: [{ offers: [] }] },
    decisions: { [home]: { kind: 'home' }, ...programs(english) },
    quietAfter: has('new program'),
    ahead: 0,
  });

  assert.deepEqual(lines, [`new program ${english}: no offer found`], errors);
  assert.ok(requests.includes(german), errors);
  assert.deepEqual(decided.map(({ page }) => page).toSorted(), [home, english]);
});

test('a copy that names a page which does not name it back is its own group, so both pages go to the models', async () => {
  await using data = await new TemporaryFiles().directory('credits-data-');
  const english = 'https://aws.amazon.com/training/startups/';
  const german = 'https://aws.amazon.com/de/training/startups/';
  const { lines, decided, errors } = await running(data.path, {
    pages: {
      ...lists([[english, 'AWS Training', 'Credits for training']]),
      [english]: localized(
        'AWS Training for Startups',
        trainingOffer,
        [['en-us', english]],
        [german],
      ),
      [german]: localized(
        'AWS Schulungen für Startups',
        'Startups erhalten bis zu 10.000 USD in AWS-Gutschriften für Schulungen.',
        [
          ['en-us', english],
          ['de-de', german],
        ],
      ),
    },
    model: { [english]: [trainingCredits], [german]: [{ offers: [] }] },
    decisions: programs(english, german),
    quietAfter: (lines) =>
      lines.filter((line) => line.startsWith('new program')).length === 2,
    ahead: 0,
  });

  assert.deepEqual(
    lines.toSorted(),
    [
      `new program ${german}: no offer found`,
      `new program ${english}: credits $10,000 ("${trainingOffer}")`,
    ],
    errors,
  );
  assert.deepEqual(decided.map(({ page }) => page).toSorted(), [
    german,
    english,
  ]);
});

test("a program whose list links a German copy takes the label of the copy's English page, so when Jev labels that page home the program is logged as no program page found", async () => {
  await using data = await new TemporaryFiles().directory('credits-data-');
  const english = 'https://aws.amazon.com/training/startups/';
  const german = 'https://aws.amazon.com/de/training/startups/';
  const copies = [
    ['en-us', english],
    ['de-de', german],
  ] as const;
  const { lines, errors } = await running(data.path, {
    pages: {
      ...lists([[german, 'AWS Training', 'Credits for training']]),
      [english]: localized(
        'AWS Training',
        'Learn to build on AWS with courses for every role.',
        copies,
      ),
      [german]: localized(
        'AWS Schulungen',
        'Lernen Sie, auf AWS zu bauen, mit Kursen für jede Rolle.',
        copies,
      ),
    },
    model: {},
    // The German copy stands alone until its English page is stored.
    decisions: { [english]: { kind: 'home' }, [german]: { kind: 'home' } },
    until: has('AWS Training: no program page found'),
    ahead: 0,
  });

  assert.deepEqual(
    lines,
    [`AWS Training: no program page found (${german} linked by ${avinash})`],
    errors,
  );
});

test("a program whose list links a German copy is not logged as missing while Jev cannot label the copy's English page", async () => {
  await using data = await new TemporaryFiles().directory('credits-data-');
  const english = 'https://aws.amazon.com/training/startups/';
  const german = 'https://aws.amazon.com/de/training/startups/';
  const copies = [
    ['en-us', english],
    ['de-de', german],
  ] as const;
  const { lines, errors } = await running(data.path, {
    pages: {
      ...lists([[german, 'AWS Training', 'Credits for training']]),
      [english]: localized('AWS Training for Startups', trainingOffer, copies),
      [german]: localized(
        'AWS Schulungen für Startups',
        'Startups erhalten bis zu 10.000 USD in AWS-Gutschriften für Schulungen.',
        copies,
      ),
    },
    model: {},
    decisions: {
      [english]: { status: 429, message: 'Rate limit exceeded' },
      [german]: { kind: 'home' },
    },
    quietAfter: has('could not label'),
    ahead: 0,
  });

  assert.deepEqual(
    lines,
    [`could not label ${english}: Rate limit exceeded`],
    errors,
  );
});

test('copies whose pages disagree on which one is x-default still send one page to the models, the smallest URL of those that any of them calls x-default', async () => {
  await using data = await new TemporaryFiles().directory('credits-data-');
  const global = 'https://www.figma.com/startups';
  const british = 'https://www.figma.com/gb/startups';
  const { lines, decided, errors } = await running(data.path, {
    pages: {
      ...lists([[british, 'Figma', 'Free seats']]),
      [global]: localized('Figma for Startups', 'Our startup program.', [
        ['x-default', global],
        ['en-gb', british],
      ]),
      [british]: localized('Figma for Startups (UK)', 'Our startup program.', [
        ['x-default', british],
        ['en', global],
      ]),
    },
    model: { [british]: [{ offers: [] }] },
    decisions: programs(british),
    quietAfter: has('new program'),
    ahead: 0,
  });

  assert.deepEqual(lines, [`new program ${british}: no offer found`], errors);
  assert.deepEqual(
    decided.map(({ page }) => page),
    [british],
  );
});

test('the API answers only its consumers: no key or a wrong key gets 401 and no programs, and each key that the app names gets the programs', async () => {
  await using data = await new TemporaryFiles().directory('credits-data-');
  const microsoft = 'https://www.microsoft.com/en-us/startups';
  await running(data.path, {
    pages: {
      ...lists([[microsoft, 'Microsoft', 'Up to $150,000']]),
      [microsoft]: microsoftProgram,
    },
    model: { [microsoft]: [microsoftOffers] },
    decisions: programs(microsoft),
    ahead: 0,
    during: async ({ api, quiet }) => {
      await quiet(has('new program'));
      const none = await api('/v1/programs', { key: null });
      const wrong = await api('/v1/programs', { key: 'sk_credits_wrong' });
      const first = await api('/v1/programs');
      const second = await api('/v1/programs', { key: secondKey });

      assert.deepEqual(
        [none.status, wrong.status, first.status, second.status],
        [401, 401, 200, 200],
      );
      assert.doesNotMatch(
        JSON.stringify([none.body, wrong.body]),
        /microsoft/u,
      );
      const urls = z
        .object({ programs: z.array(z.object({ url: z.string() })) })
        .transform(({ programs: listed }) => listed.map(({ url }) => url));
      assert.deepEqual(urls.parse(first.body), [microsoft]);
      assert.deepEqual(urls.parse(second.body), [microsoft]);
    },
  });
});

test('a query that comes while a pass runs is refused with crawl_running and is not kept, and no search runs for it', async () => {
  await using data = await new TemporaryFiles().directory('credits-data-');
  // A program page that never answers, so the pass that reads the list does
  // not end.
  const held = 'https://slow.example.com/startups';
  const { searched } = await running(data.path, {
    pages: {
      ...lists([[held, 'Slow', 'Up to $1,000']]),
      [held]: { hold: true },
    },
    model: {},
    decisions: {},
    ahead: 0,
    during: async ({ api, quiet, requests }) => {
      await quiet(() => requests.includes(held));
      const added = await api('/v1/queries', {
        method: 'POST',
        body: {
          criteria: [
            { name: 'credits', description: 'The program gives free credits' },
          ],
        },
      });
      const kept = await api('/v1/queries');

      assert.equal(added.status, 409);
      assert.equal(
        z.object({ error: z.object({ code: z.string() }) }).parse(added.body)
          .error.code,
        'crawl_running',
      );
      assert.deepEqual(kept.body, { queries: [] });
    },
  });
  assert.deepEqual(searched, []);
});

// A page of the event log, as /v1/events and a query's events give it.
const eventsSchema = z.object({
  events: z.array(
    z.object({
      cursor: z.string(),
      type: z.string(),
      data: z.unknown(),
      previous: z.unknown(),
    }),
  ),
  nextCursor: z.string(),
});
const errorCode = (body: unknown) =>
  z.object({ error: z.object({ code: z.string() }) }).parse(body).error.code;

test('after the event log starts again, a cursor of the old log is gone with resync_required, a cursor the API never gave is invalid, and the new log starts with the programs', async () => {
  await using data = await new TemporaryFiles().directory('credits-data-');
  const microsoft = 'https://www.microsoft.com/en-us/startups';
  const internet = {
    pages: {
      ...lists([[microsoft, 'Microsoft', 'Up to $150,000']]),
      [microsoft]: microsoftProgram,
    },
    model: { [microsoft]: [microsoftOffers] },
    decisions: programs(microsoft),
    ahead: 0,
  };
  let old = '';
  await running(data.path, {
    ...internet,
    during: async ({ api, quiet }) => {
      await quiet(has('new program'));
      old = eventsSchema.parse((await api('/v1/events')).body).nextCursor;
    },
  });
  // Stored data is disposable: the fix for old output is a fresh run, which
  // starts the API's file again.
  await rm(join(data.path, 'startup-credits', 'api.sqlite'));

  await running(data.path, {
    ...internet,
    during: async ({ api, quiet }) => {
      await quiet(() => true);
      const gone = await api(`/v1/events?cursor=${old}`);
      const invalid = await api('/v1/events?cursor=not-a-cursor');
      const fresh = eventsSchema.parse((await api('/v1/events')).body);

      assert.deepEqual(
        [gone.status, errorCode(gone.body)],
        [410, 'resync_required'],
      );
      assert.deepEqual(
        [invalid.status, errorCode(invalid.body)],
        [400, 'invalid_cursor'],
      );
      assert.deepEqual(
        fresh.events.map(({ type }) => type),
        ['program.added'],
      );
    },
  });
});

test('a search that fails leaves its query failed with the reason, and the API still serves the programs of the lists', async () => {
  await using data = await new TemporaryFiles().directory('credits-data-');
  const microsoft = 'https://www.microsoft.com/en-us/startups';
  // The endpoint's 500, as the AI SDK retries it twice before it gives up.
  const failure: Search = {
    for: ['The program gives free credits'],
    status: 500,
    body: {
      error: {
        message: 'The server had an error while processing your request.',
        type: 'server_error',
      },
    },
  };
  await running(data.path, {
    pages: {
      ...lists([[microsoft, 'Microsoft', 'Up to $150,000']]),
      [microsoft]: microsoftProgram,
    },
    model: { [microsoft]: [microsoftOffers] },
    decisions: programs(microsoft),
    searches: [failure, failure, failure],
    // The query's criteria still judge the programs that the crawl holds.
    verdicts: judgements,
    ahead: 0,
    during: async ({ api, quiet }) => {
      await quiet(has('new program'));
      const added = await api('/v1/queries', {
        method: 'POST',
        body: {
          criteria: [
            { name: 'credits', description: 'The program gives free credits' },
          ],
        },
      });
      const { id } = z.object({ id: z.string() }).parse(added.body);
      await quiet(has('could not search'));
      const query = await api(`/v1/queries/${id}`);
      const listed = await api('/v1/programs');

      assert.equal(added.status, 202);
      const { search } = z
        .object({ search: z.object({ state: z.string(), error: z.string() }) })
        .parse(query.body);
      assert.equal(search.state, 'failed');
      assert.match(
        search.error,
        /The server had an error while processing your request\./u,
      );
      assert.deepEqual(
        z
          .object({ programs: z.array(z.object({ url: z.string() })) })
          .parse(listed.body)
          .programs.map(({ url }) => url),
        [microsoft],
      );
    },
  });
});

// A program as /v1/programs gives it, with the fields a consumer reads.
const listedSchema = z.object({
  programs: z.array(
    z.object({
      id: z.string(),
      url: z.string(),
      company: z.object({ domain: z.string(), name: z.string() }),
      offers: z.array(z.record(z.string(), z.unknown())),
    }),
  ),
  nextPageToken: z.string().nullable(),
});

test('a program carries its company, its offers with the money in cents and the quote that states each offer; a program with no offer is listed too; page_size and page_token page through every program', async () => {
  await using data = await new TemporaryFiles().directory('credits-data-');
  const aws = 'https://aws.amazon.com/startups/credits';
  const microsoft = 'https://www.microsoft.com/en-us/startups';
  await running(data.path, {
    pages: {
      ...lists([
        [aws, 'AWS', 'Up to $200,000'],
        [microsoft, 'Microsoft', 'Up to $150,000'],
      ]),
      [aws]: awsProgram('$200,000'),
      [microsoft]: microsoftProgram,
    },
    model: { [aws]: [{ offers: [] }], [microsoft]: [microsoftOffers] },
    decisions: programs(aws, microsoft),
    ahead: 0,
    during: async ({ api, quiet }) => {
      await quiet(
        (lines) =>
          lines.filter((line) => line.startsWith('new program')).length === 2,
      );
      const first = listedSchema.parse(
        (await api('/v1/programs?page_size=1')).body,
      );
      assert.equal(first.programs.length, 1);
      assert.equal(typeof first.nextPageToken, 'string');
      const second = listedSchema.parse(
        (
          await api(
            `/v1/programs?page_size=1&page_token=${first.nextPageToken}`,
          )
        ).body,
      );
      const invalid = await api('/v1/programs?page_token=not-a-token');

      assert.equal(second.programs.length, 1);
      assert.equal(second.nextPageToken, null);
      assert.deepEqual(
        [invalid.status, errorCode(invalid.body)],
        [400, 'invalid_page_token'],
      );
      const [awsProgramListed, microsoftListed] = [
        ...first.programs,
        ...second.programs,
      ];
      assert.deepEqual(
        { url: awsProgramListed?.url, offers: awsProgramListed?.offers },
        { url: aws, offers: [] },
      );
      assert.equal(awsProgramListed?.company.domain, 'amazon.com');
      assert.deepEqual(
        {
          url: microsoftListed?.url,
          domain: microsoftListed?.company.domain,
          offers: microsoftListed?.offers,
        },
        {
          url: microsoft,
          domain: 'microsoft.com',
          offers: [
            {
              kind: 'credits',
              value: { amount: 15_000_000, currency: 'usd' },
              duration: null,
              who: null,
              evidence: { quote: 'up to $150,000 in credits' },
            },
          ],
        },
      );
    },
  });
});

test('two program pages on one registrable domain are one company', async () => {
  await using data = await new TemporaryFiles().directory('credits-data-');
  const microsoft = 'https://www.microsoft.com/en-us/startups';
  const learn = 'https://learn.microsoft.com/en-us/startups';
  await running(data.path, {
    pages: {
      ...lists([
        [microsoft, 'Microsoft', 'Up to $150,000'],
        [learn, 'Microsoft Learn', 'Startups hub'],
      ]),
      [microsoft]: microsoftProgram,
      [learn]: microsoftProgram,
    },
    model: { [microsoft]: [microsoftOffers], [learn]: [microsoftOffers] },
    decisions: programs(microsoft, learn),
    ahead: 0,
    during: async ({ api, quiet }) => {
      await quiet(
        (lines) =>
          lines.filter((line) => line.startsWith('new program')).length === 2,
      );
      const { companies } = z
        .object({
          companies: z.array(
            z.object({
              domain: z.string(),
              programs: z.array(z.object({ url: z.string() })),
            }),
          ),
        })
        .parse((await api('/v1/companies')).body);

      assert.deepEqual(
        companies.map(({ domain, programs: listed }) => ({
          domain,
          urls: listed.map(({ url }) => url).toSorted(),
        })),
        [{ domain: 'microsoft.com', urls: [learn, microsoft] }],
      );
    },
  });
});

test('calls to the API request no website: the API answers from what the crawl stored', async () => {
  await using data = await new TemporaryFiles().directory('credits-data-');
  const microsoft = 'https://www.microsoft.com/en-us/startups';
  await running(data.path, {
    pages: {
      ...lists([[microsoft, 'Microsoft', 'Up to $150,000']]),
      [microsoft]: microsoftProgram,
    },
    model: { [microsoft]: [microsoftOffers] },
    decisions: programs(microsoft),
    ahead: 0,
    during: async ({ api, quiet, requests }) => {
      await quiet(has('new program'));
      const before = requests.length;
      const answers = await Promise.all(
        [
          '/v1/programs',
          '/v1/companies',
          '/v1/events',
          '/v1/queries',
          '/v1/coverage',
        ].map(async (path) => (await api(path)).status),
      );
      // Any request that a call caused is written within this wait.
      await quiet(() => true);

      assert.deepEqual(answers, [200, 200, 200, 200, 200]);
      assert.deepEqual(requests.slice(before), []);
    },
  });
});

test('the event log gives one program.added for each program; a later run that changes an amount adds one program.changed with the offers before it, which the old cursor reads alone; a restart that changes nothing adds no event', async () => {
  await using data = await new TemporaryFiles().directory('credits-data-');
  const aws = 'https://aws.amazon.com/startups/credits';
  const microsoft = 'https://www.microsoft.com/en-us/startups';
  const rows = [
    [aws, 'AWS', 'Up to $200,000'],
    [microsoft, 'Microsoft', 'Up to $150,000'],
  ] as const;
  const quote = (amount: string) =>
    `Apply for up to ${amount} in AWS Activate Credits`;
  // The amounts of an offer list, as a consumer reads them.
  const amounts = (offers: unknown) =>
    z
      .object({
        offers: z.array(
          z.object({ value: z.object({ amount: z.number() }).optional() }),
        ),
      })
      .parse(offers)
      .offers.map(({ value }) => value?.amount ?? null);
  let added = '';
  await running(data.path, {
    pages: {
      ...lists(rows),
      [aws]: awsWithSupport('$200,000', 6),
      [microsoft]: microsoftProgram,
    },
    model: {
      [aws]: [awsOffers(200_000, quote('$200,000'), 6)],
      [microsoft]: [microsoftOffers],
    },
    decisions: programs(aws, microsoft),
    ahead: 0,
    during: async ({ api, quiet }) => {
      await quiet(
        (lines) =>
          lines.filter((line) => line.startsWith('new program')).length === 2,
      );
      const log = eventsSchema.parse((await api('/v1/events')).body);

      assert.deepEqual(
        log.events.map(({ type, data: program }) => [
          type,
          z.object({ url: z.string() }).parse(program).url,
        ]),
        [
          ['program.added', aws],
          ['program.added', microsoft],
        ],
      );
      added = log.nextCursor;
    },
  });

  let changed = '';
  await running(data.path, {
    pages: {
      ...lists(rows),
      [aws]: awsWithSupport('$100,000', 6),
      [microsoft]: microsoftProgram,
    },
    model: { [aws]: [awsOffers(100_000, quote('$100,000'), 6)] },
    decisions: programs(aws, microsoft),
    ahead: 31 * 24 * 3_600_000,
    during: async ({ api, quiet }) => {
      await quiet(has('offers changed'));
      const log = eventsSchema.parse(
        (await api(`/v1/events?cursor=${added}`)).body,
      );

      assert.deepEqual(
        log.events.map(({ type, data: program, previous }) => ({
          type,
          url: z.object({ url: z.string() }).parse(program).url,
          now: amounts(program),
          before: amounts(previous),
        })),
        [
          {
            type: 'program.changed',
            url: aws,
            now: [10_000_000, 500_000, null],
            before: [20_000_000, 500_000, null],
          },
        ],
      );
      changed = log.nextCursor;
    },
  });

  await running(data.path, {
    pages: {
      ...lists(rows),
      [aws]: awsWithSupport('$100,000', 6),
      [microsoft]: microsoftProgram,
    },
    model: {},
    decisions: programs(aws, microsoft),
    ahead: 62 * 24 * 3_600_000,
    during: async ({ api, quiet, requests }) => {
      await quiet(() => requests.includes(microsoft));
      const log = eventsSchema.parse(
        (await api(`/v1/events?cursor=${changed}`)).body,
      );

      assert.deepEqual(log.events, []);
    },
  });
});

// The page that the searches find and no list links (claudeProgram above),
// and the program page that the list of the query tests links.
const claude = 'https://claude.com/programs/startups';
const microsoft = 'https://www.microsoft.com/en-us/startups';

// The criteria of the queries, and what the criterion model answers for
// each page: Anthropic trains its models and gives credits, Microsoft gives
// credits.
const aiLab = {
  name: 'ai_lab',
  description: 'The company trains its own AI models',
};
const givesCredits = {
  name: 'credits',
  description: 'The program gives free credits',
};
const claudeLab: Verdict = {
  quote:
    'Access discounts and credits worth up to $45,000 from companies building with Claude.',
  meets: true,
  reason: 'The program is run by the company that makes Claude.',
};
const claudeCredits: Verdict = {
  quote:
    'Access discounts and credits worth up to $45,000 from companies building with Claude.',
  meets: true,
  reason: 'Members can receive API credits.',
};
const microsoftLab: Verdict = {
  quote: null,
  meets: false,
  reason: 'The page names no model that Microsoft trains.',
};
const microsoftCredits: Verdict = {
  quote: 'up to $150,000 in credits',
  meets: true,
  reason: 'The program gives credits.',
};
const judgements = {
  [claude]: {
    [aiLab.description]: claudeLab,
    [givesCredits.description]: claudeCredits,
  },
  [microsoft]: {
    [aiLab.description]: microsoftLab,
    [givesCredits.description]: microsoftCredits,
  },
};

// The program page that the list links, and what the models answer for it
// and for the pages that the searches find.
const queried = {
  pages: {
    ...lists([[microsoft, 'Microsoft', 'Up to $150,000']]),
    [microsoft]: microsoftProgram,
    [claude]: claudeProgram,
  },
  model: { [microsoft]: [microsoftOffers], [claude]: [claudeOffers] },
  decisions: programs(microsoft, claude),
  verdicts: judgements,
  ahead: 0,
};

// Asks the API for a new query with the given criteria, and gives its id.
async function ask(
  api: Serving['api'],
  criteria: readonly { name: string; description: string }[],
) {
  const added = await api('/v1/queries', {
    method: 'POST',
    body: { criteria },
  });
  assert.equal(added.status, 202, JSON.stringify(added.body));
  return { id: z.object({ id: z.string() }).parse(added.body).id, added };
}

// The programs that meet every criterion of a query, with their verdicts.
const itemsSchema = z.object({
  items: z.array(
    z.object({
      program: z.object({ url: z.string() }),
      verdicts: z.array(z.record(z.string(), z.unknown())),
    }),
  ),
});

// True once the criterion model judged the page on the given number of
// criteria.
const judgedOn =
  (page: string, criteria: number): Holds =>
  (_lines, _asked, _decided, judged) =>
    judged.filter((call) => call.page === page).length >= criteria;

test('a query between passes is accepted with its progress, the pages that its search finds are crawled and judged with every program on each criterion, and its items are the programs that meet every criterion, with each reason and quote', async () => {
  await using data = await new TemporaryFiles().directory('credits-data-');
  const { searched } = await running(data.path, {
    ...queried,
    searches: [
      {
        for: [aiLab.description, givesCredits.description],
        pages: [{ url: claude, company: 'Anthropic' }],
      },
    ],
    during: async ({ api, quiet }) => {
      await quiet(has('new program'));
      const { id, added } = await ask(api, [aiLab, givesCredits]);
      await quiet(
        (...seen) =>
          judgedOn(claude, 2)(...seen) && judgedOn(microsoft, 2)(...seen),
      );
      const items = itemsSchema.parse(
        (await api(`/v1/queries/${id}/items`)).body,
      );
      const query = await api(`/v1/queries/${id}`);
      const listed = listedSchema.parse((await api('/v1/programs')).body);

      assert.deepEqual(
        z
          .object({ search: z.unknown(), judging: z.unknown() })
          .parse(added.body),
        {
          search: { state: 'pending' },
          judging: { judged: 0, failed: 0, pending: 2 },
        },
      );
      assert.deepEqual(items.items, [
        {
          program: items.items[0]?.program,
          verdicts: [
            { criterion: 'ai_lab', state: 'judged', ...claudeLab },
            { criterion: 'credits', state: 'judged', ...claudeCredits },
          ],
        },
      ]);
      assert.equal(items.items[0]?.program.url, claude);
      assert.deepEqual(
        z
          .object({
            search: z.object({ state: z.string() }),
            judging: z.unknown(),
            seeds: z.array(z.object({ url: z.string(), crawl: z.unknown() })),
          })
          .parse(query.body),
        {
          search: { state: 'done' },
          judging: { judged: 4, failed: 0, pending: 0 },
          seeds: [{ url: claude, crawl: { state: 'read' } }],
        },
      );
      assert.deepEqual(
        listed.programs.map(({ url }) => url),
        [claude, microsoft],
      );
    },
  });
  assert.deepEqual(
    searched.map(({ model, tools }) => ({ model, tools })),
    [{ model: 'gpt-6.1-terra', tools: ['web_search'] }],
  );
});

test('a page that a search found and that does not load, such as a bot challenge, is failed with its reason in the coverage and in its query, beside the page that loaded', async () => {
  await using data = await new TemporaryFiles().directory('credits-data-');
  const openai = 'https://openai.com/startups/';
  await running(data.path, {
    ...queried,
    pages: { ...queried.pages, [openai]: cloudflareChallenge },
    searches: [
      {
        for: [givesCredits.description],
        pages: [
          { url: openai, company: 'OpenAI' },
          { url: claude, company: 'Anthropic' },
        ],
      },
    ],
    during: async ({ api, quiet, requests }) => {
      await quiet(has('new program'));
      const { id } = await ask(api, [givesCredits]);
      // A starting URL that fails is the pass's failure, which the app
      // records for the API and does not log.
      await quiet(
        (...seen) => requests.includes(openai) && judgedOn(claude, 1)(...seen),
      );
      const seeds = z.object({
        seeds: z.array(
          z.object({
            url: z.string(),
            company: z.string(),
            crawl: z.object({
              state: z.string(),
              reason: z.string().optional(),
            }),
          }),
        ),
      });
      const coverage = seeds.parse((await api('/v1/coverage')).body).seeds;
      const query = seeds.parse((await api(`/v1/queries/${id}`)).body).seeds;

      for (const listed of [coverage, query])
        assert.deepEqual(listed, [
          {
            url: openai,
            company: 'OpenAI',
            crawl: {
              state: 'failed',
              reason:
                'Request failed with status code 403 (Forbidden): GET https://openai.com/startups/',
            },
          },
          { url: claude, company: 'Anthropic', crawl: { state: 'read' } },
        ]);
    },
  });
});

test("a query's events give item.matched for each program that comes to meet its criteria, and none for one that does not", async () => {
  await using data = await new TemporaryFiles().directory('credits-data-');
  await running(data.path, {
    ...queried,
    searches: [
      {
        for: [aiLab.description, givesCredits.description],
        pages: [{ url: claude, company: 'Anthropic' }],
      },
    ],
    during: async ({ api, quiet }) => {
      await quiet(has('new program'));
      const { id } = await ask(api, [aiLab, givesCredits]);
      await quiet(
        (...seen) =>
          judgedOn(claude, 2)(...seen) && judgedOn(microsoft, 2)(...seen),
      );
      const log = eventsSchema.parse(
        (await api(`/v1/queries/${id}/events`)).body,
      );

      assert.deepEqual(
        log.events.map(({ type, data: item }) => [
          type,
          z.object({ program: z.object({ url: z.string() }) }).parse(item)
            .program.url,
        ]),
        [['item.matched', claude]],
      );
    },
  });
});

test('a verdict that quotes a sentence the page does not have keeps its answer and no quote', async () => {
  await using data = await new TemporaryFiles().directory('credits-data-');
  await running(data.path, {
    ...queried,
    verdicts: {
      ...judgements,
      [claude]: {
        ...judgements[claude],
        [aiLab.description]: {
          ...claudeLab,
          quote: 'Anthropic trains Claude, its own family of models.',
        },
      },
    },
    searches: [
      {
        for: [aiLab.description],
        pages: [{ url: claude, company: 'Anthropic' }],
      },
    ],
    during: async ({ api, quiet }) => {
      await quiet(has('new program'));
      const { id } = await ask(api, [aiLab]);
      await quiet(judgedOn(claude, 1));
      const items = itemsSchema.parse(
        (await api(`/v1/queries/${id}/items`)).body,
      );

      assert.deepEqual(
        items.items.map(({ program, verdicts }) => [program.url, verdicts]),
        [
          [
            claude,
            [
              {
                criterion: 'ai_lab',
                state: 'judged',
                meets: true,
                reason: claudeLab.reason,
                quote: null,
              },
            ],
          ],
        ],
      );
    },
  });
});

test('a program that the crawl stores after a query exists is judged on its criteria and becomes its item, and a restart that reads unchanged pages judges none of them again', async () => {
  await using data = await new TemporaryFiles().directory('credits-data-');
  const aws = 'https://aws.amazon.com/startups/credits';
  let id = '';
  let after = '';
  const first = await running(data.path, {
    ...queried,
    searches: [
      {
        for: [givesCredits.description],
        pages: [{ url: claude, company: 'Anthropic' }],
      },
    ],
    during: async ({ api, quiet }) => {
      await quiet(has('new program'));
      ({ id } = await ask(api, [givesCredits]));
      await quiet(
        (...seen) =>
          judgedOn(claude, 1)(...seen) && judgedOn(microsoft, 1)(...seen),
      );
      after = eventsSchema.parse(
        (await api(`/v1/queries/${id}/events`)).body,
      ).nextCursor;
    },
  });
  assert.deepEqual(first.judged.map(({ page }) => page).toSorted(), [
    claude,
    microsoft,
  ]);

  // A month later, when every page is due again, the list links AWS too.
  const second = await running(data.path, {
    ...queried,
    pages: {
      ...queried.pages,
      ...lists([
        [microsoft, 'Microsoft', 'Up to $150,000'],
        [aws, 'AWS', 'Up to $200,000'],
      ]),
      [aws]: awsProgram('$200,000'),
    },
    model: {
      [aws]: [
        awsOffers(
          200_000,
          'Apply for up to $200,000 in AWS Activate Credits',
          6,
        ),
      ],
    },
    decisions: programs(microsoft, claude, aws),
    verdicts: {
      ...judgements,
      [aws]: {
        [givesCredits.description]: {
          quote: 'Up to $5,000 USD in Activate Credits',
          meets: true,
          reason: 'The program gives credits.',
        },
      },
    },
    ahead: 31 * 24 * 3_600_000,
    during: async ({ api, quiet }) => {
      await quiet(judgedOn(aws, 1));
      const log = eventsSchema.parse(
        (await api(`/v1/queries/${id}/events?cursor=${after}`)).body,
      );
      const items = itemsSchema.parse(
        (await api(`/v1/queries/${id}/items`)).body,
      );

      assert.deepEqual(
        log.events.map(({ type, data: item }) => [
          type,
          z.object({ program: z.object({ url: z.string() }) }).parse(item)
            .program.url,
        ]),
        [['item.matched', aws]],
      );
      assert.deepEqual(
        items.items.map(({ program }) => program.url),
        [aws, claude, microsoft],
      );
    },
  });
  assert.deepEqual(
    second.judged.map(({ page }) => page),
    [aws],
  );
});

test('two queries with different criteria over the same programs have different items', async () => {
  await using data = await new TemporaryFiles().directory('credits-data-');
  await running(data.path, {
    ...queried,
    searches: [
      {
        for: [aiLab.description],
        pages: [{ url: claude, company: 'Anthropic' }],
      },
      { for: [givesCredits.description], pages: [] },
    ],
    during: async ({ api, quiet }) => {
      await quiet(has('new program'));
      const labs = await ask(api, [aiLab]);
      await quiet(
        (...seen) =>
          judgedOn(claude, 1)(...seen) && judgedOn(microsoft, 1)(...seen),
      );
      const credits = await ask(api, [givesCredits]);
      await quiet(
        (...seen) =>
          judgedOn(claude, 2)(...seen) && judgedOn(microsoft, 2)(...seen),
      );
      const urls = async (queryId: string) =>
        itemsSchema
          .parse((await api(`/v1/queries/${queryId}/items`)).body)
          .items.map(({ program }) => program.url);

      assert.deepEqual(await urls(labs.id), [claude]);
      assert.deepEqual(await urls(credits.id), [claude, microsoft]);
    },
  });
});

test('a verdict whose call fails is failed in the progress of its query, and its program is no item', async () => {
  await using data = await new TemporaryFiles().directory('credits-data-');
  await running(data.path, {
    ...queried,
    verdicts: {
      ...judgements,
      // A request that the endpoint refuses, which the AI SDK does not retry.
      [claude]: {
        [givesCredits.description]: {
          status: 400,
          body: {
            error: {
              message: 'The request was not valid.',
              type: 'invalid_request_error',
            },
          },
        },
      },
    },
    searches: [
      {
        for: [givesCredits.description],
        pages: [{ url: claude, company: 'Anthropic' }],
      },
    ],
    during: async ({ api, quiet }) => {
      await quiet(has('new program'));
      const { id } = await ask(api, [givesCredits]);
      await quiet(
        (...seen) =>
          judgedOn(claude, 1)(...seen) && judgedOn(microsoft, 1)(...seen),
      );
      const items = itemsSchema.parse(
        (await api(`/v1/queries/${id}/items`)).body,
      );
      const { judging } = z
        .object({ judging: z.unknown() })
        .parse((await api(`/v1/queries/${id}`)).body);
      const log = eventsSchema.parse(
        (await api(`/v1/queries/${id}/events`)).body,
      );

      assert.deepEqual(
        items.items.map(({ program }) => program.url),
        [microsoft],
      );
      assert.deepEqual(judging, { judged: 1, failed: 1, pending: 0 });
      assert.deepEqual(
        log.events.map(({ type, data: item }) => [
          type,
          z.object({ program: z.object({ url: z.string() }) }).parse(item)
            .program.url,
        ]),
        [['item.matched', microsoft]],
      );
    },
  });
});

test("a program whose page changes so that it no longer meets a query's criteria gives item.unmatched, and leaves the query's items", async () => {
  await using data = await new TemporaryFiles().directory('credits-data-');
  let id = '';
  let after = '';
  await running(data.path, {
    ...queried,
    searches: [
      {
        for: [givesCredits.description],
        pages: [{ url: claude, company: 'Anthropic' }],
      },
    ],
    during: async ({ api, quiet }) => {
      await quiet(has('new program'));
      ({ id } = await ask(api, [givesCredits]));
      await quiet(
        (...seen) =>
          judgedOn(claude, 1)(...seen) && judgedOn(microsoft, 1)(...seen),
      );
      after = eventsSchema.parse(
        (await api(`/v1/queries/${id}/events`)).body,
      ).nextCursor;
    },
  });

  // A month later, Microsoft's page no longer offers credits.
  await running(data.path, {
    ...queried,
    pages: {
      ...queried.pages,
      [microsoft]: ok(
        microsoftProgram.body.replace(
          '<b>up to $150,000 in credits</b>',
          'mentorship',
        ),
      ),
    },
    model: { [microsoft]: [{ offers: [] }] },
    verdicts: {
      ...judgements,
      [microsoft]: {
        [givesCredits.description]: {
          quote: null,
          meets: false,
          reason: 'The page offers mentorship and no credits.',
        },
      },
    },
    ahead: 31 * 24 * 3_600_000,
    during: async ({ api, quiet }) => {
      await quiet(judgedOn(microsoft, 1));
      const log = eventsSchema.parse(
        (await api(`/v1/queries/${id}/events?cursor=${after}`)).body,
      );
      const items = itemsSchema.parse(
        (await api(`/v1/queries/${id}/items`)).body,
      );

      assert.deepEqual(
        log.events.map(({ type, data: item }) => [
          type,
          z.object({ program: z.object({ url: z.string() }) }).parse(item)
            .program.url,
        ]),
        [['item.unmatched', microsoft]],
      );
      assert.deepEqual(
        items.items.map(({ program }) => program.url),
        [claude],
      );
    },
  });
});

test('a deleted query is gone: the API answers 204, then not_found for it, and lists no query', async () => {
  await using data = await new TemporaryFiles().directory('credits-data-');
  await running(data.path, {
    ...queried,
    searches: [{ for: [givesCredits.description], pages: [] }],
    during: async ({ api, quiet }) => {
      await quiet(has('new program'));
      const { id } = await ask(api, [givesCredits]);
      await quiet(judgedOn(microsoft, 1));
      const deleted = await api(`/v1/queries/${id}`, { method: 'DELETE' });
      const query = await api(`/v1/queries/${id}`);
      const items = await api(`/v1/queries/${id}/items`);
      const listed = await api('/v1/queries');

      assert.equal(deleted.status, 204);
      assert.deepEqual(
        [query.status, errorCode(query.body)],
        [404, 'not_found'],
      );
      assert.deepEqual(
        [items.status, errorCode(items.body)],
        [404, 'not_found'],
      );
      assert.deepEqual(listed.body, { queries: [] });
    },
  });
});
