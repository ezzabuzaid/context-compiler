import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import test from 'node:test';

import { TemporaryFiles } from '@zukhruf/testing/fs';
import { z } from 'zod';

// A page with its content type, or a page that never answers, so the pass
// that requests it keeps running.
type Served = {
  readonly status: number;
  readonly type: string;
  readonly body: string;
};
type Page = Served | { readonly hold: true };
const ok = (body: string): Served => ({
  status: 200,
  type: 'text/html; charset=utf-8',
  body,
});

// A list of links on a page of its own, as a reading list or an awesome list
// is: the pages it links are the candidates of a dataset that names it.
const list = 'https://lists.example.com/ai-reading';
const claude = 'https://claude.com/programs/startups';
const microsoft = 'https://www.microsoft.com/en-us/startups';
const paper = 'https://papers.example.com/agent-memory';
const listPage = (links: readonly string[]) =>
  ok(`<!doctype html><html><head><title>AI reading list</title></head><body>
<nav><a href="/">Lists</a></nav>
<main><h1>AI reading list</h1><ul>
${links.map((href) => `<li><a href="${href}">${href}</a></li>`).join('\n')}
</ul></main></body></html>`);
// claude.com/programs/startups, trimmed on 2026-10-31.
const claudeProgram =
  ok(`<!doctype html><html><head><title>Claude for Startups</title></head><body>
<main><h1>Claude for Startups</h1><p>Access discounts and credits worth up to $45,000 from companies building with Claude.</p></main></body></html>`);
// microsoft.com/en-us/startups, trimmed on 2026-10-30, with its amount.
const microsoftProgram = (amount: string) =>
  ok(`<!doctype html><html><head><title>Microsoft for Startups | Microsoft</title></head><body>
<main><h1>Microsoft for Startups</h1><p>Access cutting-edge AI models, developer tools, and <b>up to ${amount} in credits</b>, backed by Microsoft’s global customer network.</p></main></body></html>`);
// A paper about memory for agents, as a white paper page states it.
const paperPage =
  ok(`<!doctype html><html><head><title>Agentic memory for language model agents</title></head><body>
<main><h1>Agentic memory for language model agents</h1><p>We present a memory system that lets language model agents organize and recall their past experiences.</p></main></body></html>`);

// The two consumers' datasets over the same list: startup credit
// programs, with their amount and who runs them, and papers about memory
// for agents, with their title.
const givesCredits = 'The program gives startups free credits';
const aboutMemory = 'The page is about memory for AI agents';
const amount = 'The largest amount of credits, in US dollars';
const runBy = 'Who runs the program';
const titled = 'The title of the paper';
const creditsDataset = {
  title: 'Startup credit programs',
  criteria: [{ description: givesCredits }],
  lists: [list],
  fields: [
    { name: 'amount', description: amount, format: 'number' },
    {
      name: 'run_by',
      description: runBy,
      format: 'options',
      options: ['ai_lab', 'cloud', 'other'],
    },
  ],
};
const memoryDataset = {
  title: 'Memory papers',
  criteria: [{ description: aboutMemory }],
  lists: [list],
  fields: [{ name: 'title', description: titled, format: 'text' }],
};

// What the criterion model answers about a page on a criterion, and what
// the field model reads from it.
type Evaluation =
  | {
      readonly quote: string | null;
      readonly satisfied: 'yes' | 'no' | 'unclear';
      readonly reasoning: string;
    }
  | { readonly status: number; readonly body: Record<string, unknown> };
type FieldAnswer = {
  readonly quote: string | null;
  readonly value: string | number | null;
};
// What the search model answers to each search, in turn, for a prompt that
// names every text of for: the pages that it found, or an error in the
// endpoint's shape.
type Search = { readonly for: readonly string[] } & (
  | { readonly pages: readonly { readonly url: string }[] }
  | { readonly status: number; readonly body: Record<string, unknown> }
);

const evaluations: Readonly<
  Record<string, Readonly<Record<string, Evaluation>>>
> = {
  [claude]: {
    [givesCredits]: {
      quote:
        'Access discounts and credits worth up to $45,000 from companies building with Claude.',
      satisfied: 'yes',
      reasoning: 'The program gives credits.',
    },
    [aboutMemory]: {
      quote: null,
      satisfied: 'no',
      reasoning: 'A program page.',
    },
  },
  [microsoft]: {
    [givesCredits]: {
      quote: 'up to $150,000 in credits',
      satisfied: 'yes',
      reasoning: 'The program gives credits.',
    },
    [aboutMemory]: {
      quote: null,
      satisfied: 'no',
      reasoning: 'A program page.',
    },
  },
  [paper]: {
    [givesCredits]: { quote: null, satisfied: 'no', reasoning: 'A paper.' },
    [aboutMemory]: {
      quote:
        'We present a memory system that lets language model agents organize and recall their past experiences.',
      satisfied: 'yes',
      reasoning: 'The paper is about memory for agents.',
    },
  },
};
const fieldAnswers: Readonly<
  Record<string, Readonly<Record<string, FieldAnswer>>>
> = {
  [claude]: {
    [amount]: {
      quote:
        'Access discounts and credits worth up to $45,000 from companies building with Claude.',
      value: 45_000,
    },
    [runBy]: { quote: null, value: 'ai_lab' },
  },
  [microsoft]: {
    [amount]: { quote: 'up to $150,000 in credits', value: 150_000 },
    [runBy]: { quote: null, value: 'cloud' },
  },
  [paper]: {
    [titled]: {
      quote: 'Agentic memory for language model agents',
      value: 'Agentic memory for language model agents',
    },
  },
};
const pages = {
  [list]: listPage([claude, microsoft, paper]),
  [claude]: claudeProgram,
  [microsoft]: microsoftProgram('$150,000'),
  [paper]: paperPage,
};

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

type Internet = {
  readonly pages: Readonly<Record<string, Page>>;
  readonly searches?: readonly Search[];
  readonly evaluations?: Readonly<
    Record<string, Readonly<Record<string, Evaluation>>>
  >;
  readonly fields?: Readonly<
    Record<string, Readonly<Record<string, FieldAnswer>>>
  >;
  readonly ahead: number;
};

// The internet as the app's process sees it in a test, loaded before
// main.ts: these pages answer, every robots.txt and sitemap.xml that a test
// does not give is missing, any other request fails, and each request is
// written to stderr. The Codex Responses endpoint streams each answer in the
// events of a real GPT-6-Luna answer captured on 2026-11-02: a search, which
// asks for pages with the web_search tool, gets the next planned search; an
// evaluation gets the planned answer of its page and criterion; a field the
// planned answer of its page and field. A request with no planned answer is
// written to stderr as unplanned. The clock runs ahead by the given
// milliseconds, since a test cannot wait a month for the pages to be due
// again.
const internet = ({
  pages: served,
  searches = [],
  evaluations: judged = {},
  fields = {},
  ahead,
}: Internet) => `
import { Msw } from ${JSON.stringify(import.meta.resolve('@zukhruf/testing/msw'))};
import { HttpResponse, http } from ${JSON.stringify(import.meta.resolve('msw'))};
const pages = ${JSON.stringify(served)};
const searches = ${JSON.stringify(searches)};
const evaluations = ${JSON.stringify(judged)};
const fields = ${JSON.stringify(fields)};
let searched = 0;
// A garbage dataset every 50 ms, as a long-running app has them: an
// object that the app holds only weakly is gone by the stop.
setInterval(() => globalThis.gc(), 50).unref();
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
const planned = (answer) =>
  'status' in answer
    ? HttpResponse.json(answer.body, { status: answer.status, headers: { 'retry-after': '0' } })
    : undefined;
const { server } = new Msw().intercept(
  ...Object.entries(pages).map(([url, page]) =>
    http.get(url, () =>
      'hold' in page
        ? new Promise(() => {})
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
    if ('pages' in properties) {
      process.stderr.write('search ' + JSON.stringify({ model: body.model, tools: (body.tools ?? []).map(({ type }) => type), prompt }) + '\\n');
      const answer = searches[searched++];
      if (answer === undefined || !answer.for.every((text) => prompt.includes(text))) {
        process.stderr.write('unplanned search ' + searched + '\\n');
        return HttpResponse.error();
      }
      return planned(answer) ?? stream(body.model, JSON.stringify({ pages: answer.pages }));
    }
    if ('satisfied' in properties) {
      const criterion = /^Criterion: (.+)$/mu.exec(prompt)?.[1];
      process.stderr.write('evaluation ' + JSON.stringify({ page, about: criterion, model: body.model }) + '\\n');
      const answer = evaluations[page]?.[criterion];
      if (answer === undefined) {
        process.stderr.write('unplanned evaluation on ' + criterion + ' for ' + page + '\\n');
        return HttpResponse.error();
      }
      return planned(answer) ?? stream(body.model, JSON.stringify(answer));
    }
    const field = /^Field: (.+)$/mu.exec(prompt)?.[1];
    process.stderr.write('field ' + JSON.stringify({ page, about: field, model: body.model }) + '\\n');
    const answer = fields[page]?.[field];
    if (answer === undefined) {
      process.stderr.write('unplanned field ' + field + ' for ' + page + '\\n');
      return HttpResponse.error();
    }
    return stream(body.model, JSON.stringify(answer));
  }),
);
server.events.on('request:start', ({ request }) => process.stderr.write('request ' + request.url + '\\n'));
`;

// One request to a model, as the internet writes it to stderr: an
// evaluation or a field names its page and what it asks about.
const askedSchema = z.object({
  page: z.string(),
  about: z.string(),
  model: z.string(),
});
type Asked = z.infer<typeof askedSchema>;
const searchedSchema = z.object({
  model: z.string(),
  tools: z.array(z.string()),
  prompt: z.string(),
});
type Searched = z.infer<typeof searchedSchema>;

// Checked on each line that the app writes.
type Holds = (seen: {
  readonly lines: readonly string[];
  readonly requests: readonly string[];
  readonly evaluated: readonly Asked[];
  readonly read: readonly Asked[];
  readonly searched: readonly Searched[];
}) => boolean;

// The keys of the API's two consumers, which the app's environment names.
const apiKey = 'sk_websets_test';
const secondKey = 'sk_websets_second';

// The running app as a test calls it: its API, with a consumer's key unless
// the call gives another or none, and a wait that ends two seconds after the
// app's last line once holds is true, so what the last answer causes is
// recorded by then (the app checks the warehouse every second).
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
};

// Runs the app with its files in the data folder until the test's calls to
// its API end, then stops it as Ctrl-C does. A run that stops first, at the
// thirty seconds, fails the test, as does a failed call or a model request
// that the test did not plan. Gives each model request and the URLs that
// the app requested.
async function running(
  data: string,
  {
    during,
    ...planned
  }: Internet & { readonly during: (app: Serving) => Promise<void> },
) {
  await using folder = await new TemporaryFiles().directory('internet-');
  const setup = join(folder.path, 'internet.mjs');
  await writeFile(setup, internet(planned));
  await writeFile(join(folder.path, 'auth.json'), codexLogin, { mode: 0o600 });
  const ended = new AbortController();
  // The thirty seconds after which the harness sends a second SIGINT.
  const deadline = AbortSignal.timeout(30_000);
  const app = spawn(
    process.execPath,
    ['--expose-gc', '--import', setup, join(import.meta.dirname, 'main.ts')],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      // Only what the app needs, and none of the developer's logins:
      // XDG_DATA_HOME, the test's own folder, holds the app's files,
      // CODEX_HOME holds the test's ChatGPT login, which the Codex provider
      // reads, and the API takes the consumers' keys on any free port.
      // NODE_OPTIONS and WRITE_TEST_MUTANT are what the write-test skill's
      // mutate.mjs sets for the processes of a proof, so a mutant of the
      // app's code loads into the app too; a test run outside a proof has no
      // WRITE_TEST_MUTANT, and an unset variable is not passed.
      env: {
        XDG_DATA_HOME: data,
        CODEX_HOME: folder.path,
        WEBSETS_API_KEYS: `${apiKey},${secondKey}`,
        PORT: '0',
        NODE_OPTIONS: process.env.NODE_OPTIONS,
        WRITE_TEST_MUTANT: process.env.WRITE_TEST_MUTANT,
      },
    },
  );
  // SIGINT when the calls end, as Ctrl-C stops the app, and another at the
  // deadline, as a second Ctrl-C ends a stop that hangs.
  for (const stop of [ended.signal, deadline]) {
    stop.addEventListener('abort', () => app.kill('SIGINT'), { once: true });
  }
  const exited = new Promise<NodeJS.Signals | null>((resolve, reject) => {
    app.once('exit', (_, signal) => resolve(signal));
    app.once('error', reject);
  });
  const seen: {
    lines: string[];
    requests: string[];
    evaluated: Asked[];
    read: Asked[];
    searched: Searched[];
  } = { lines: [], requests: [], evaluated: [], read: [], searched: [] };
  const unplanned: string[] = [];
  const errors: string[] = [];
  const waits: { holds: Holds; resolve: () => void; timer?: NodeJS.Timeout }[] =
    [];
  const check = () => {
    for (const wait of waits)
      if (wait.holds(seen)) {
        clearTimeout(wait.timer);
        wait.timer = setTimeout(() => {
          waits.splice(waits.indexOf(wait), 1);
          wait.resolve();
        }, 2_000);
      }
  };
  // How the test's calls to the API ended.
  const calls: { state: 'waiting' | 'done' | { readonly error: Error } } = {
    state: 'waiting',
  };
  const serve = (base: string) =>
    during({
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
          body: call.body === undefined ? undefined : JSON.stringify(call.body),
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
      quiet: (holds) =>
        new Promise<void>((resolve) => {
          waits.push({ holds, resolve });
          check();
        }),
    }).then(
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
  createInterface({ input: app.stdout }).on('line', (line) => {
    // The API's address is not one of the app's lines.
    const api = /^API on (http:\/\/localhost:\d+)$/u.exec(line)?.[1];
    if (api === undefined) seen.lines.push(line);
    else void serve(api);
    check();
  });
  createInterface({ input: app.stderr }).on('line', (line) => {
    const [kind] = line.split(' ', 1);
    const rest = line.slice(`${kind} `.length);
    if (kind === 'request') seen.requests.push(rest);
    else if (kind === 'evaluation')
      seen.evaluated.push(askedSchema.parse(JSON.parse(rest)));
    else if (kind === 'field')
      seen.read.push(askedSchema.parse(JSON.parse(rest)));
    else if (kind === 'search')
      seen.searched.push(searchedSchema.parse(JSON.parse(rest)));
    else if (kind === 'unplanned') unplanned.push(line);
    else errors.push(line);
    check();
  });
  const signal = await exited;
  for (const wait of waits) clearTimeout(wait.timer);
  if (calls.state === 'waiting')
    assert.fail(
      [
        'The app stopped before the calls to its API ended.',
        `lines: ${JSON.stringify(seen.lines)}`,
        `last requests: ${JSON.stringify(seen.requests.slice(-8))}`,
        ...errors,
      ].join('\n'),
    );
  if (typeof calls.state === 'object') throw calls.state.error;
  assert.deepEqual(unplanned, [], errors.join('\n'));
  // The first SIGINT stops the app, and it dies by it, as a shell and a
  // container expect, not only when the harness sends another at its
  // deadline (#3929).
  assert.deepEqual(
    { signal, beforeTheDeadline: !deadline.aborted },
    { signal: 'SIGINT', beforeTheDeadline: true },
    errors.join('\n'),
  );
  return seen;
}

// True once the models answered about the page the given number of times.
const evaluatedOn =
  (page: string, times: number): Holds =>
  ({ evaluated }) =>
    evaluated.filter((call) => call.page === page).length >= times;
const readOn =
  (page: string, times: number): Holds =>
  ({ read }) =>
    read.filter((call) => call.page === page).length >= times;
const all =
  (...holds: readonly Holds[]): Holds =>
  (seen) =>
    holds.every((given) => given(seen));

// Asks the API for a new dataset, and gives its id.
async function create(api: Serving['api'], body: unknown) {
  const created = await api('/v1/datasets', { method: 'POST', body });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return z.object({ id: z.string() }).parse(created.body).id;
}

// The items of a dataset as a consumer reads them.
const itemsSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      url: z.string(),
      source: z.string(),
      evaluations: z.array(z.record(z.string(), z.unknown())),
      fields: z.record(z.string(), z.unknown()),
    }),
  ),
  hasMore: z.boolean(),
  nextCursor: z.string().nullable(),
});
const eventsSchema = z.object({
  data: z.array(
    z.object({
      type: z.string(),
      data: z.object({
        url: z.string(),
        fields: z.record(z.string(), z.unknown()),
      }),
      previous: z.unknown(),
    }),
  ),
  nextCursor: z.string(),
});
const errorCode = (body: unknown) =>
  z.object({ error: z.object({ code: z.string() }) }).parse(body).error.code;
const urls = (body: unknown) =>
  itemsSchema.parse(body).data.map(({ url }) => url);

test('the API answers only its consumers: no key or a wrong key gets 401, and each key that the app names gets the datasets', async () => {
  await using data = await new TemporaryFiles().directory('websets-data-');
  await running(data.path, {
    pages,
    ahead: 0,
    during: async ({ api }) => {
      const none = await api('/v1/datasets', { key: null });
      const wrong = await api('/v1/datasets', { key: 'sk_websets_wrong' });
      const first = await api('/v1/datasets');
      const second = await api('/v1/datasets', { key: secondKey });

      assert.deepEqual(
        [none.status, wrong.status, first.status, second.status],
        [401, 401, 200, 200],
      );
      assert.deepEqual(
        [errorCode(none.body), errorCode(wrong.body)],
        ['unauthenticated', 'unauthenticated'],
      );
      assert.deepEqual(first.body, { data: [] });
    },
  });
});

test("a dataset's items are the pages its list links that meet every criterion, each with its evaluations and its fields in their formats", async () => {
  await using data = await new TemporaryFiles().directory('websets-data-');
  await running(data.path, {
    pages,
    evaluations,
    fields: fieldAnswers,
    ahead: 0,
    during: async ({ api, quiet }) => {
      const id = await create(api, creditsDataset);
      await quiet(
        all(
          evaluatedOn(claude, 1),
          evaluatedOn(microsoft, 1),
          evaluatedOn(paper, 1),
          readOn(claude, 2),
          readOn(microsoft, 2),
        ),
      );
      const items = itemsSchema.parse(
        (await api(`/v1/datasets/${id}/items`)).body,
      );

      assert.deepEqual(
        items.data.map(({ url, source, evaluations: given, fields }) => ({
          url,
          source,
          evaluations: given,
          fields,
        })),
        [
          {
            url: claude,
            source: 'list',
            evaluations: [
              {
                criterion: givesCredits,
                state: 'judged',
                ...evaluations[claude]![givesCredits],
              },
            ],
            fields: {
              amount: {
                state: 'read',
                value: 45_000,
                quote:
                  'Access discounts and credits worth up to $45,000 from companies building with Claude.',
              },
              run_by: { state: 'read', value: 'ai_lab', quote: null },
            },
          },
          {
            url: microsoft,
            source: 'list',
            evaluations: [
              {
                criterion: givesCredits,
                state: 'judged',
                ...evaluations[microsoft]![givesCredits],
              },
            ],
            fields: {
              amount: {
                state: 'read',
                value: 150_000,
                quote: 'up to $150,000 in credits',
              },
              run_by: { state: 'read', value: 'cloud', quote: null },
            },
          },
        ],
      );
      assert.equal(items.hasMore, false);
    },
  });
});

test("a dataset's search finds pages with the query and the criteria, the crawl reads them, and they become its items, with the search and its pages in the dataset's progress", async () => {
  await using data = await new TemporaryFiles().directory('websets-data-');
  const query = 'AI labs that give startups free credits';
  const { searched } = await running(data.path, {
    pages,
    evaluations,
    searches: [{ for: [query, givesCredits], pages: [{ url: claude }] }],
    ahead: 0,
    during: async ({ api, quiet }) => {
      const id = await create(api, {
        title: 'AI lab credits',
        search: { query, count: 5 },
        criteria: [{ description: givesCredits }],
      });
      await quiet(evaluatedOn(claude, 1));
      const items = itemsSchema.parse(
        (await api(`/v1/datasets/${id}/items`)).body,
      );
      const { progress } = z
        .object({
          progress: z.object({
            search: z.object({ state: z.string() }),
            seeds: z.array(z.unknown()),
            items: z.number(),
          }),
        })
        .parse((await api(`/v1/datasets/${id}`)).body);

      assert.deepEqual(
        items.data.map(({ url, source }) => [url, source]),
        [[claude, 'search']],
      );
      assert.deepEqual(progress, {
        search: { state: 'done' },
        seeds: [{ url: claude, rank: 1, crawl: { state: 'read' } }],
        items: 1,
      });
    },
  });
  assert.deepEqual(
    searched.map(({ model, tools }) => ({ model, tools })),
    [{ model: 'gpt-6-luna', tools: ['web_search'] }],
  );
});

test('two datasets over the same list have the items of their own criteria', async () => {
  await using data = await new TemporaryFiles().directory('websets-data-');
  await running(data.path, {
    pages,
    evaluations,
    fields: fieldAnswers,
    ahead: 0,
    during: async ({ api, quiet }) => {
      const credits = await create(api, creditsDataset);
      await quiet(all(readOn(claude, 2), readOn(microsoft, 2)));
      const memory = await create(api, memoryDataset);
      await quiet(readOn(paper, 1));

      assert.deepEqual(
        urls((await api(`/v1/datasets/${credits}/items`)).body),
        [claude, microsoft],
      );
      assert.deepEqual(urls((await api(`/v1/datasets/${memory}/items`)).body), [
        paper,
      ]);
    },
  });
});

test('a dataset that comes while a pass runs is refused with crawl_running and is not kept', async () => {
  await using data = await new TemporaryFiles().directory('websets-data-');
  const held = 'https://slow.example.com/startups';
  await running(data.path, {
    pages: { ...pages, [list]: listPage([held]), [held]: { hold: true } },
    ahead: 0,
    during: async ({ api, quiet }) => {
      await create(api, creditsDataset);
      await quiet(({ requests }) => requests.includes(held));
      const refused = await api('/v1/datasets', {
        method: 'POST',
        body: memoryDataset,
      });
      const kept = z
        .object({ data: z.array(z.object({ title: z.string() })) })
        .parse((await api('/v1/datasets')).body);

      assert.deepEqual(
        [refused.status, errorCode(refused.body)],
        [409, 'crawl_running'],
      );
      assert.deepEqual(
        kept.data.map(({ title }) => title),
        [creditsDataset.title],
      );
    },
  });
});

test('the events give item.created for each page that comes to meet the criteria, and the last event of each item gives its fields as the items do; a later run gives item.updated with the fields before a change and item.removed for a page that no longer meets them, which the old cursor reads alone', async () => {
  await using data = await new TemporaryFiles().directory('websets-data-');
  let id = '';
  let after = '';
  await running(data.path, {
    pages,
    evaluations,
    fields: fieldAnswers,
    ahead: 0,
    during: async ({ api, quiet }) => {
      id = await create(api, creditsDataset);
      await quiet(all(readOn(claude, 2), readOn(microsoft, 2)));
      const log = eventsSchema.parse(
        (await api(`/v1/datasets/${id}/events`)).body,
      );
      const items = itemsSchema.parse(
        (await api(`/v1/datasets/${id}/items`)).body,
      );

      assert.deepEqual(
        log.data
          .filter(({ type }) => type === 'item.created')
          .map(({ data: item }) => item.url)
          .toSorted(),
        [claude, microsoft],
      );
      // The log reports the net change since its last check, so fields read
      // within one check come with item.created, and later ones with
      // item.updated: either way, a consumer that reads every event ends
      // with each item as the items give it.
      assert.deepEqual(
        new Map(log.data.map(({ data: item }) => [item.url, item.fields])),
        new Map(items.data.map(({ url, fields }) => [url, fields])),
      );
      after = log.nextCursor;
    },
  });

  // A month later, when the pages are due again: Microsoft's amount is
  // lower, and Claude's page no longer gives credits.
  const noCredits = ok(
    claudeProgram.body.replace(
      'Access discounts and credits worth up to $45,000 from companies building with Claude.',
      'Join a community of founders building with Claude.',
    ),
  );
  await running(data.path, {
    pages: {
      ...pages,
      [claude]: noCredits,
      [microsoft]: microsoftProgram('$100,000'),
    },
    evaluations: {
      ...evaluations,
      [claude]: {
        [givesCredits]: {
          quote: null,
          satisfied: 'no',
          reasoning: 'The page gives no credits.',
        },
      },
      [microsoft]: {
        [givesCredits]: {
          quote: 'up to $100,000 in credits',
          satisfied: 'yes',
          reasoning: 'The program gives credits.',
        },
      },
    },
    fields: {
      [microsoft]: {
        [amount]: { quote: 'up to $100,000 in credits', value: 100_000 },
        [runBy]: { quote: null, value: 'cloud' },
      },
    },
    ahead: 31 * 24 * 3_600_000,
    during: async ({ api, quiet }) => {
      await quiet(all(evaluatedOn(claude, 1), readOn(microsoft, 2)));
      const log = eventsSchema.parse(
        (await api(`/v1/datasets/${id}/events?cursor=${after}`)).body,
      );

      assert.deepEqual(
        log.data
          .map(({ type, data: item, previous }) => ({
            type,
            url: item.url,
            previous,
          }))
          .toSorted((a, b) => a.type.localeCompare(b.type)),
        [
          { type: 'item.removed', url: claude, previous: null },
          {
            type: 'item.updated',
            url: microsoft,
            previous: { fields: { amount: 150_000, run_by: 'cloud' } },
          },
        ],
      );
    },
  });
});

test('after the event log starts again, a cursor of the old log is gone with resync_required, and a cursor the API never gave is invalid', async () => {
  await using data = await new TemporaryFiles().directory('websets-data-');
  let id = '';
  let old = '';
  await running(data.path, {
    pages,
    evaluations,
    fields: fieldAnswers,
    ahead: 0,
    during: async ({ api, quiet }) => {
      id = await create(api, creditsDataset);
      await quiet(all(readOn(claude, 2), readOn(microsoft, 2)));
      old = eventsSchema.parse(
        (await api(`/v1/datasets/${id}/events`)).body,
      ).nextCursor;
    },
  });
  // The fix for old output is a fresh run: a new event log, in a new file.
  await rm(join(data.path, 'websets', 'api.sqlite'));
  // The dataset went with the file, so the run makes it again.
  await running(data.path, {
    pages,
    evaluations,
    fields: fieldAnswers,
    ahead: 0,
    during: async ({ api, quiet }) => {
      const again = await create(api, creditsDataset);
      await quiet(() => true);
      const gone = await api(`/v1/datasets/${again}/events?cursor=${old}`);
      const invalid = await api(
        `/v1/datasets/${again}/events?cursor=not-a-cursor`,
      );

      assert.equal(gone.status, 410);
      assert.equal(errorCode(gone.body), 'resync_required');
      assert.equal(invalid.status, 400);
      assert.equal(errorCode(invalid.body), 'invalid_cursor');
    },
  });
});

test("a search that fails is failed with its reason in the dataset's progress, and the pages of its list are still judged", async () => {
  await using data = await new TemporaryFiles().directory('websets-data-');
  const query = 'AI labs that give startups free credits';
  // The endpoint's 500, as the AI SDK retries it twice before it gives up.
  const failure: Search = {
    for: [query],
    status: 500,
    body: {
      error: {
        message: 'The server had an error while processing your request.',
        type: 'server_error',
      },
    },
  };
  await running(data.path, {
    pages,
    evaluations,
    fields: fieldAnswers,
    searches: [failure, failure, failure],
    ahead: 0,
    during: async ({ api, quiet }) => {
      const id = await create(api, {
        ...creditsDataset,
        search: { query, count: 5 },
      });
      await quiet(
        all(
          ({ lines }) =>
            lines.some((line) => line.startsWith('could not search')),
          readOn(microsoft, 2),
        ),
      );
      const { progress } = z
        .object({
          progress: z.object({
            search: z.object({ state: z.string(), error: z.string() }),
          }),
        })
        .parse((await api(`/v1/datasets/${id}`)).body);

      assert.equal(progress.search.state, 'failed');
      assert.match(
        progress.search.error,
        /The server had an error while processing your request\./u,
      );
      assert.deepEqual(urls((await api(`/v1/datasets/${id}/items`)).body), [
        claude,
        microsoft,
      ]);
    },
  });
});

test('a dataset that the API cannot keep is refused with invalid_argument and not kept: no criteria, a monitor without a search, a cron that is not one', async () => {
  await using data = await new TemporaryFiles().directory('websets-data-');
  await running(data.path, {
    pages,
    ahead: 0,
    during: async ({ api }) => {
      const refused = [];
      for (const body of [
        { ...creditsDataset, criteria: [] },
        { ...creditsDataset, monitor: { cron: '0 9 * * 1' } },
        {
          ...creditsDataset,
          search: { query: 'credits' },
          monitor: { cron: 'not a cron at all' },
        },
      ]) {
        refused.push(await api('/v1/datasets', { method: 'POST', body }));
      }
      const [noCriteria] = refused;

      assert.deepEqual(
        refused.map(({ status, body }) => [status, errorCode(body)]),
        [
          [400, 'invalid_argument'],
          [400, 'invalid_argument'],
          [400, 'invalid_argument'],
        ],
      );
      assert.deepEqual(
        Object.keys(
          z
            .object({
              error: z.object({
                detail: z.object({ fields: z.record(z.string(), z.unknown()) }),
              }),
            })
            .parse(noCriteria?.body).error.detail.fields,
        ),
        ['criteria'],
      );
      assert.deepEqual((await api('/v1/datasets')).body, { data: [] });
    },
  });
});

test('a deleted dataset is gone: 204, then not_found, and no dataset is listed', async () => {
  await using data = await new TemporaryFiles().directory('websets-data-');
  await running(data.path, {
    pages,
    evaluations,
    fields: fieldAnswers,
    ahead: 0,
    during: async ({ api, quiet }) => {
      const id = await create(api, creditsDataset);
      await quiet(all(readOn(claude, 2), readOn(microsoft, 2)));
      const deleted = await api(`/v1/datasets/${id}`, { method: 'DELETE' });
      const read = await api(`/v1/datasets/${id}`);

      assert.equal(deleted.status, 204);
      assert.equal(read.status, 404);
      assert.equal(errorCode(read.body), 'not_found');
      assert.deepEqual((await api('/v1/datasets')).body, { data: [] });
    },
  });
});

test('calls to the API request no website: it answers from what the crawl stored', async () => {
  await using data = await new TemporaryFiles().directory('websets-data-');
  await running(data.path, {
    pages,
    evaluations,
    fields: fieldAnswers,
    ahead: 0,
    during: async ({ api, quiet }) => {
      const id = await create(api, creditsDataset);
      await quiet(all(readOn(claude, 2), readOn(microsoft, 2)));
      const seen: string[] = [];
      await quiet(({ requests }) => {
        seen.splice(0, seen.length, ...requests);
        return true;
      });
      const answers = await Promise.all(
        [
          '/v1/datasets',
          `/v1/datasets/${id}`,
          `/v1/datasets/${id}/items`,
          `/v1/datasets/${id}/events`,
        ].map(async (path) => (await api(path)).status),
      );
      let after: readonly string[] = [];
      await quiet(({ requests }) => {
        after = requests;
        return true;
      });

      assert.deepEqual(answers, [200, 200, 200, 200]);
      assert.deepEqual(after.slice(seen.length), []);
    },
  });
});

test('a search answers the pages that the web search found, best first, for its query alone, and keeps no dataset', async () => {
  await using data = await new TemporaryFiles().directory('websets-data-');
  const query = 'AI labs that give startups free credits';
  const { searched } = await running(data.path, {
    pages,
    searches: [{ for: [query], pages: [{ url: claude }, { url: microsoft }] }],
    ahead: 0,
    during: async ({ api }) => {
      const answer = await api(
        `/v1/search?query=${encodeURIComponent(query)}&count=5`,
      );
      const datasets = await api('/v1/datasets');

      assert.deepEqual(
        [answer.status, answer.body],
        [
          200,
          {
            results: [
              { position: 1, url: claude },
              { position: 2, url: microsoft },
            ],
          },
        ],
      );
      assert.deepEqual(datasets.body, { data: [] });
    },
  });
  assert.deepEqual(
    searched.map(({ model, tools, prompt }) => ({
      model,
      tools,
      count: prompt.includes('At most 5 pages.'),
      criteria: prompt.includes('Criteria:'),
    })),
    [
      {
        model: 'gpt-6-luna',
        tools: ['web_search'],
        count: true,
        criteria: false,
      },
    ],
  );
});

test('a search whose web search fails answers 502 search_failed', async () => {
  await using data = await new TemporaryFiles().directory('websets-data-');
  const query = 'AI labs that give startups free credits';
  // The endpoint's 500, as the AI SDK retries it twice before it gives up.
  const failure: Search = {
    for: [query],
    status: 500,
    body: {
      error: {
        message: 'The server had an error while processing your request.',
        type: 'server_error',
      },
    },
  };
  await running(data.path, {
    pages,
    searches: [failure, failure, failure],
    ahead: 0,
    during: async ({ api }) => {
      const answer = await api(`/v1/search?query=${encodeURIComponent(query)}`);

      assert.deepEqual(
        [answer.status, errorCode(answer.body)],
        [502, 'search_failed'],
      );
    },
  });
});

// A fetch's answer as a consumer reads it.
const fetchSchema = z.object({
  results: z.array(
    z.object({
      url: z.string(),
      finalUrl: z.string(),
      title: z.string().nullable(),
      text: z.string(),
      markdown: z.string(),
      fetchedAt: z.string(),
    }),
  ),
  errors: z.array(z.object({ url: z.string(), reason: z.string() })),
});

test("a fetch answers the article of each page now and keeps no dataset; a page that the website's robots.txt disallows is an error and is never requested, and a missing page is an error with its reason", async () => {
  await using data = await new TemporaryFiles().directory('websets-data-');
  const missing = 'https://claude.com/programs/missing';
  const { requests } = await running(data.path, {
    pages: {
      ...pages,
      'https://papers.example.com/robots.txt': {
        status: 200,
        type: 'text/plain',
        body: 'User-agent: *\nDisallow: /agent-memory',
      },
      [missing]: { status: 404, type: 'text/html', body: 'Not found' },
    },
    ahead: 0,
    during: async ({ api }) => {
      const answer = await api('/v1/fetch', {
        method: 'POST',
        body: { urls: [claude, paper, missing] },
      });
      const datasets = await api('/v1/datasets');
      const { results, errors } = fetchSchema.parse(answer.body);

      assert.equal(answer.status, 200);
      assert.deepEqual(
        results.map(({ url, finalUrl, title, text }) => ({
          url,
          finalUrl,
          title,
          credits: text.includes('up to $45,000'),
        })),
        [
          {
            url: claude,
            finalUrl: claude,
            title: 'Claude for Startups',
            credits: true,
          },
        ],
      );
      assert.deepEqual(
        errors.map(({ url }) => url),
        [paper, missing],
      );
      assert.match(errors[0]!.reason, /robots\.txt .* disallows/u);
      assert.match(errors[1]!.reason, /404/u);
      assert.deepEqual(datasets.body, { data: [] });
    },
  });
  assert.equal(requests.includes(paper), false);
});
