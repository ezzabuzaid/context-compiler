import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { TemporaryFiles } from '@zukhruf/testing/fs';
import { describe, test } from '@zukhruf/testing/node';

import { promptfoo } from '../src/testing/promptfoo.ts';

// What the Codex Responses endpoint answers to one request about a page: the
// answer text of GPT-6-Luna, an error status, or an answer cut at
// maxOutputTokens before any text.
type Answer =
  | { readonly text: string }
  | { readonly status: number; readonly body: Record<string, unknown> }
  | { readonly cut: true };
const offers = (...stated: readonly Record<string, unknown>[]): Answer => ({
  text: JSON.stringify({ offers: stated }),
});
// The 500 that the AI SDK retries twice, so a failed call is three requests.
const serverError: Answer = {
  status: 500,
  body: { error: { message: 'Internal server error', type: 'server_error' } },
};

// The internet as promptfoo's process sees it, loaded before promptfoo: the
// Codex Responses endpoint streams the next answer planned for each request
// about a page whose text the request carries, in the events of a real
// GPT-6-Luna answer captured on 2026-11-02 (src/startup-credits.test.ts),
// and every other request fails. The 500 body (as in
// src/startup-credits.test.ts) and the answer cut at maxOutputTokens are
// written by hand.
const internet = (
  planned: Readonly<Record<string, readonly Answer[]>>,
  texts: Readonly<Record<string, string>>,
) => `
import { Msw } from ${JSON.stringify(import.meta.resolve('@zukhruf/testing/msw'))};
import { HttpResponse, http } from ${JSON.stringify(import.meta.resolve('msw'))};
const planned = ${JSON.stringify(planned)};
const texts = ${JSON.stringify(texts)};
const asked = new Map();
new Msw().intercept(
  http.post('https://chatgpt.com/backend-api/codex/responses', async ({ request }) => {
    const body = await request.json();
    const prompt = body.input
      .filter(({ role }) => role === 'user')
      .flatMap(({ content }) => typeof content === 'string' ? [content] : content.map(({ text }) => text))
      .join('\\n');
    const page = /^URL: (\\S+)$/mu.exec(prompt)?.[1];
    const index = asked.get(page) ?? 0;
    asked.set(page, index + 1);
    const answer = planned[page]?.[index];
    if (answer === undefined || !prompt.includes(texts[page])) {
      process.stderr.write('unplanned model request ' + (index + 1) + ' for ' + page + '\\n');
      return HttpResponse.error();
    }
    if ('status' in answer)
      return HttpResponse.json(answer.body, { status: answer.status, headers: { 'retry-after': '0' } });
    const id = 'resp_09bbfa0984043937016ae822d27cf08191a424371743d31def';
    const usage = { input_tokens: 633, input_tokens_details: { cached_tokens: 0 }, output_tokens: 65, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 698 };
    const stream = (events) => new HttpResponse(
      events.map((event, sequence_number) => 'event: ' + event.type + '\\ndata: ' + JSON.stringify({ ...event, sequence_number }) + '\\n\\n').join(''),
      { headers: { 'content-type': 'text/event-stream; charset=utf-8' } },
    );
    const response = (status, output) => ({ id, object: 'response', created_at: 1793598162, status, model: body.model, output, error: null, incomplete_details: null, service_tier: 'default' });
    if ('cut' in answer)
      return stream([
        { type: 'response.created', response: response('in_progress', []) },
        { type: 'response.incomplete', response: { ...response('incomplete', []), incomplete_details: { reason: 'max_output_tokens' }, usage } },
      ]);
    const { text } = answer;
    const item = { type: 'message', id: 'msg_09bbfa0984043937016ae822d2ead48191aafda124fab9deca', role: 'assistant', phase: 'final_answer' };
    const part = { type: 'output_text', text, annotations: [], logprobs: [] };
    const done = { ...item, status: 'completed', content: [part] };
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
      { type: 'response.completed', response: { ...response('completed', [done]), usage } },
    ];
    return stream(events);
  }),
);
`;

// The ChatGPT login of Codex in CODEX_HOME: an access token that does not
// expire before 2100, so the provider asks for no refresh, and the account
// it names.
const account = '5ba1a5a2-6d1e-4c6a-9a51-2f7f0c1d2e3f';
const token = [
  { alg: 'none', typ: 'JWT' },
  {
    exp: 4_102_444_800,
    'https://api.openai.com/auth': { chatgpt_account_id: account },
  },
]
  .map((part) => Buffer.from(JSON.stringify(part)).toString('base64url'))
  .concat('signature')
  .join('.');
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

// A frozen page: its text is its sentences, and a sentence's span is where
// it is in the text.
type Frozen = {
  readonly url: string;
  readonly role: 'test' | 'example';
  readonly kind: string;
  readonly sentences: readonly string[];
  // Each offer names the sentences that state it.
  readonly offers: readonly {
    readonly kind: string;
    readonly value: { amount: number; currency: string } | null;
    readonly in: readonly string[];
  }[];
  readonly lookalikes: readonly { readonly in: string; reason: string }[];
};
const textOf = (page: Frozen) => page.sentences.join(' ');
const spanOf = (page: Frozen, sentence: string) => {
  const start = textOf(page).indexOf(sentence);
  assert.ok(start >= 0, sentence);
  return { start, end: start + sentence.length };
};
const sha256 = (text: string) =>
  createHash('sha256').update(text).digest('hex');

// The answer key and the cache of the frozen pages, as
// promptfoo/dataset/seed.ts and the annotator write them.
const answerKeyOf = (pages: readonly Frozen[]) => ({
  frozenAt: '2026-11-01T00:00:00Z',
  annotator: 'test',
  run: '2026-10-30T00:00:00Z',
  pages: pages.map((page) => ({
    url: page.url,
    sha256: sha256(textOf(page)),
    role: page.role,
    kind: page.kind,
    offers: page.offers.map((offer) => ({
      kind: offer.kind,
      value: offer.value,
      percent: null,
      duration: null,
      who: null,
      mentions: offer.in.map((sentence) => spanOf(page, sentence)),
    })),
    lookalikes: page.lookalikes.map((lookalike) => ({
      ...spanOf(page, lookalike.in),
      reason: lookalike.reason,
    })),
  })),
});
const cacheOf = (pages: readonly Frozen[]) =>
  pages.map((page) => ({
    url: page.url,
    title: `Startups at ${new URL(page.url).hostname}`,
    list: 'https://github.com/avinash201199/awesome-startup-credits',
    loadedAt: '2026-10-30T00:00:00Z',
    sha256: sha256(textOf(page)),
    text: textOf(page),
  }));

type Run = {
  readonly results: {
    readonly prompts: readonly {
      readonly metrics: {
        readonly namedScores: Readonly<Record<string, number>>;
        readonly namedScoreWeights: Readonly<Record<string, number>>;
      };
    }[];
    readonly results: readonly {
      readonly vars: Readonly<Record<string, unknown>>;
      readonly response?: {
        readonly metadata?: Readonly<Record<string, unknown>>;
      };
      readonly testCase: {
        readonly metadata?: Readonly<Record<string, unknown>>;
      };
    }[];
  };
};

// Runs promptfoo's command line on the eval's promptfooconfig.ts with this
// answer key and cache in place of the real ones, so the real generator,
// ProgramOffers provider and offers assertion run, with the Codex Responses
// endpoint answering as planned. Gives the output file, and the pooled score
// of each named score as [hits, whole].
async function evaluate(
  key: ReturnType<typeof answerKeyOf>,
  cache: ReturnType<typeof cacheOf>,
  planned: Readonly<Record<string, readonly Answer[]>>,
) {
  await using folder = await new TemporaryFiles().directory('test-pages-');
  await writeFile(join(folder.path, 'answer-key.json'), JSON.stringify(key));
  await writeFile(join(folder.path, 'pages.json'), JSON.stringify(cache));
  await writeFile(
    join(folder.path, 'internet.mjs'),
    internet(
      planned,
      Object.fromEntries(cache.map(({ url, text }) => [url, text])),
    ),
  );
  await writeFile(join(folder.path, 'auth.json'), codexLogin, { mode: 0o600 });
  await writeFile(
    join(folder.path, 'promptfooconfig.mjs'),
    `import config from ${JSON.stringify(join(import.meta.dirname, 'promptfooconfig.ts'))};
export default {
  ...config,
  tests: { ...config.tests, config: ${JSON.stringify({
    answerKey: join(folder.path, 'answer-key.json'),
    pages: join(folder.path, 'pages.json'),
  })} },
};
`,
  );
  // The test's ChatGPT login, which the provider reads.
  const { stderr } = await promptfoo(
    folder.path,
    [
      'eval',
      '-c',
      'promptfooconfig.mjs',
      '--no-write',
      '--no-cache',
      '-o',
      'out.json',
    ],
    {
      imports: [join(folder.path, 'internet.mjs')],
      env: { CODEX_HOME: folder.path },
    },
  );
  assert.doesNotMatch(stderr, /unplanned model request/u, stderr);
  const run: Run = JSON.parse(
    await readFile(join(folder.path, 'out.json'), 'utf8'),
  );
  const [prompt] = run.results.prompts;
  assert.ok(prompt);
  const { namedScores, namedScoreWeights } = prompt.metrics;
  const pooled = Object.fromEntries(
    Object.entries(namedScoreWeights).map(([name, whole]) => [
      name,
      [namedScores[name], whole],
    ]),
  );
  return { run, pooled };
}

// The pooled scores that each test reads: [hits, whole].
const scoresOf = (pooled: Readonly<Record<string, unknown>>) => ({
  valid: pooled['valid'],
  'items recall': pooled['items recall'],
  'items precision': pooled['items precision'],
  kind: pooled['$.offers[*].kind recall by field'],
  amount: pooled['$.offers[*].value.amount recall by field'],
  currency: pooled['$.offers[*].value.currency recall by field'],
});

const credits = 'Eligible startups get $30,000 in cloud credits.';
const community = 'Join a community of founders and mentors.';
const programPage = (
  url: string,
  offers: Frozen['offers'],
  extra: readonly string[] = [],
): Frozen => ({
  url,
  role: 'test',
  kind: 'program',
  sentences: ['Build faster with us.', credits, community, ...extra],
  offers,
  lookalikes: [],
});
const thirtyThousand = { amount: 30_000, currency: 'USD' };
const statedCredits = (quote: string, value: unknown) => ({
  quote,
  kind: 'credits',
  value,
  duration: null,
  who: null,
});
const statedSupport = (quote: string) => ({
  quote,
  kind: 'support',
  who: null,
});

// One page in each row, with what the model answers and the pooled scores
// of the run, as [hits, whole].
const scenarios: readonly {
  readonly name: string;
  readonly page: Frozen;
  readonly answers: readonly Answer[];
  readonly scores: ReturnType<typeof scoresOf>;
  // Why the call failed, as the row's metadata says.
  readonly failed?: string;
}[] = [
  {
    name: 'an offer stated as labelled scores every number 1',
    page: programPage('https://exact.example/startups', [
      { kind: 'credits', value: thirtyThousand, in: [credits] },
    ]),
    answers: [offers(statedCredits(credits, thirtyThousand))],
    scores: {
      valid: [1, 1],
      'items recall': [1, 1],
      'items precision': [1, 1],
      kind: [1, 1],
      amount: [1, 1],
      currency: [1, 1],
    },
  },
  {
    name: 'credits and support in one sentence are two offers, each found with its kind',
    page: programPage(
      'https://both.example/startups',
      [
        { kind: 'credits', value: { amount: 5_000, currency: 'USD' }, in: [] },
        { kind: 'support', value: null, in: [] },
      ].map((offer) => ({
        ...offer,
        in: ['Get $5,000 in credits and free technical support.'],
      })),
      ['Get $5,000 in credits and free technical support.'],
    ),
    answers: [
      offers(
        statedSupport('Get $5,000 in credits and free technical support.'),
        statedCredits('Get $5,000 in credits and free technical support.', {
          amount: 5_000,
          currency: 'USD',
        }),
      ),
    ],
    scores: {
      valid: [1, 1],
      'items recall': [2, 2],
      'items precision': [2, 2],
      kind: [2, 2],
      amount: [1, 1],
      currency: [1, 1],
    },
  },
  {
    name: 'an offer of the wrong kind is found, with its kind, amount and currency wrong',
    page: programPage('https://kind.example/startups', [
      { kind: 'credits', value: thirtyThousand, in: [credits] },
    ]),
    answers: [
      offers({
        quote: credits,
        kind: 'discount',
        percent: null,
        duration: null,
        who: null,
      }),
    ],
    scores: {
      valid: [1, 1],
      'items recall': [1, 1],
      'items precision': [1, 1],
      kind: [0, 1],
      amount: [0, 1],
      currency: [0, 1],
    },
  },
  {
    name: 'an offer with the wrong amount is found, with its amount wrong and its currency right',
    page: programPage('https://amount.example/startups', [
      { kind: 'credits', value: thirtyThousand, in: [credits] },
    ]),
    answers: [
      offers(statedCredits(credits, { amount: 50_000, currency: 'USD' })),
    ],
    scores: {
      valid: [1, 1],
      'items recall': [1, 1],
      'items precision': [1, 1],
      kind: [1, 1],
      amount: [0, 1],
      currency: [1, 1],
    },
  },
  {
    name: 'an offer with the wrong currency is found, with its amount right and its currency wrong',
    page: programPage('https://currency.example/startups', [
      { kind: 'credits', value: thirtyThousand, in: [credits] },
    ]),
    answers: [
      offers(statedCredits(credits, { amount: 30_000, currency: 'EUR' })),
    ],
    scores: {
      valid: [1, 1],
      'items recall': [1, 1],
      'items precision': [1, 1],
      kind: [1, 1],
      amount: [1, 1],
      currency: [0, 1],
    },
  },
  {
    name: 'an offer read from a lookalike sentence is a wrong offer, and the labelled offer is missed',
    page: {
      ...programPage(
        'https://lookalike.example/startups',
        [{ kind: 'credits', value: thirtyThousand, in: [credits] }],
        ['Startups must have raised less than $5,000,000 to apply.'],
      ),
      lookalikes: [
        {
          in: 'Startups must have raised less than $5,000,000 to apply.',
          reason: 'eligibility',
        },
      ],
    },
    answers: [
      offers(
        statedCredits(
          'Startups must have raised less than $5,000,000 to apply.',
          { amount: 5_000_000, currency: 'USD' },
        ),
      ),
    ],
    scores: {
      valid: [1, 1],
      'items recall': [0, 1],
      'items precision': [0, 1],
      kind: [0, 1],
      amount: [0, 1],
      currency: [0, 1],
    },
  },
  {
    name: 'an offer stated on a home page is a wrong offer, also when the page has labelled offers',
    page: {
      ...programPage('https://home.example/', [
        { kind: 'credits', value: thirtyThousand, in: [credits] },
      ]),
      kind: 'home',
    },
    answers: [offers(statedCredits(credits, thirtyThousand))],
    scores: {
      valid: [1, 1],
      'items recall': [0, 0],
      'items precision': [0, 1],
      kind: undefined,
      amount: undefined,
      currency: undefined,
    },
  },
  {
    name: 'a page whose call failed is graded as the answer null, so its offers stay in the wholes of recall',
    page: programPage('https://failed.example/startups', [
      { kind: 'credits', value: thirtyThousand, in: [credits] },
      { kind: 'support', value: null, in: [community] },
    ]),
    answers: [serverError, serverError, serverError],
    scores: {
      valid: [0, 1],
      'items recall': [0, 2],
      'items precision': [0, 0],
      kind: [0, 2],
      amount: [0, 1],
      currency: [0, 1],
    },
    failed: 'Internal server error',
  },
  {
    name: 'an answer cut before any text is graded as the answer null, so its offers stay in the wholes of recall',
    page: programPage('https://cut.example/startups', [
      { kind: 'credits', value: thirtyThousand, in: [credits] },
    ]),
    answers: [{ cut: true }],
    scores: {
      valid: [0, 1],
      'items recall': [0, 1],
      'items precision': [0, 0],
      kind: [0, 1],
      amount: [0, 1],
      currency: [0, 1],
    },
  },
  {
    name: 'an answer that does not agree with the schema is invalid: its offers are wrong, and the labelled offers stay in recall',
    page: programPage('https://invalid.example/startups', [
      { kind: 'credits', value: thirtyThousand, in: [credits] },
    ]),
    answers: [{ text: '{"offers":[{"kind":"credits"}]}' }],
    scores: {
      valid: [0, 1],
      'items recall': [0, 1],
      'items precision': [0, 1],
      kind: [0, 1],
      amount: [0, 1],
      currency: [0, 1],
    },
  },
  {
    name: 'an offer that the answer leaves out is missed, and the offer it states is right',
    page: programPage('https://missing.example/startups', [
      { kind: 'credits', value: thirtyThousand, in: [credits] },
      { kind: 'support', value: null, in: [community] },
    ]),
    answers: [offers(statedCredits(credits, thirtyThousand))],
    scores: {
      valid: [1, 1],
      'items recall': [1, 2],
      'items precision': [1, 1],
      kind: [1, 2],
      amount: [1, 1],
      currency: [1, 1],
    },
  },
];

void describe(
  'the offers eval over the test pages',
  // Four runs at once, as the CI runner has four CPUs.
  { concurrency: 4 },
  () => {
    void test.each(scenarios, (scenario) =>
      test(scenario.name, async () => {
        const { run, pooled } = await evaluate(
          answerKeyOf([scenario.page]),
          cacheOf([scenario.page]),
          { [scenario.page.url]: scenario.answers },
        );

        assert.deepEqual(scoresOf(pooled), scenario.scores);
        assert.deepEqual(
          run.results.results.map(
            ({ response }) => response?.metadata?.['failed'],
          ),
          [scenario.failed],
        );
      }),
    );

    void test('all pages in one run pool each score over the pages: hits over wholes, not the mean of the pages', async () => {
      const pages = scenarios.map(({ page }) => page);
      const { pooled } = await evaluate(
        answerKeyOf(pages),
        cacheOf(pages),
        Object.fromEntries(
          scenarios.map(({ page, answers }) => [page.url, answers]),
        ),
      );

      // score.ts counts the same 7 offers found of 13 labelled (the failed,
      // the cut and the invalid page keep their 4 in the 13), 6 with the
      // right kind.
      // It counts 2 wrong offers, the lookalike and the home page; the offer
      // of the invalid answer is the third here (ADR 0011).
      assert.deepEqual(scoresOf(pooled), {
        valid: [8, 11],
        'items recall': [7, 13],
        'items precision': [7, 10],
        kind: [6, 13],
        amount: [4, 10],
        currency: [4, 10],
      });
    });

    void test('the eval has one row for each test page of the answer key, with the page from the cache and its kind', async () => {
      const program = programPage('https://program.example/startups', [
        { kind: 'credits', value: thirtyThousand, in: [credits] },
      ]);
      const example: Frozen = {
        ...programPage('https://example.example/startups', []),
        role: 'example',
      };
      const home: Frozen = {
        ...programPage('https://home.example/', []),
        kind: 'home',
      };
      const pages = [program, example, home];
      const { run } = await evaluate(answerKeyOf(pages), cacheOf(pages), {
        [program.url]: [offers()],
        [home.url]: [offers()],
      });

      assert.deepEqual(
        run.results.results
          .map(({ vars, testCase }) => ({
            vars,
            kind: testCase.metadata?.['kind'],
          }))
          .toSorted((a, b) =>
            String(a.vars['url']).localeCompare(String(b.vars['url'])),
          ),
        [home, program].map((page) => ({
          vars: {
            url: page.url,
            title: `Startups at ${new URL(page.url).hostname}`,
            text: textOf(page),
          },
          kind: page.kind,
        })),
      );
    });

    void test('a cache that holds other text than the labels stops the eval', async () => {
      const page = programPage('https://stale.example/startups', [
        { kind: 'credits', value: thirtyThousand, in: [credits] },
      ]);
      const [frozen] = cacheOf([page]);
      assert.ok(frozen);

      await assert.rejects(
        evaluate(
          answerKeyOf([page]),
          [
            {
              ...frozen,
              text: `${frozen.text} Updated.`,
              sha256: sha256(`${frozen.text} Updated.`),
            },
          ],
          {},
        ),
        (error: { readonly stdout: string; readonly stderr: string }) => {
          assert.match(
            error.stdout + error.stderr,
            /https:\/\/stale\.example\/startups: the cache holds other text than the labels/u,
          );
          return true;
        },
      );
    });
  },
);
