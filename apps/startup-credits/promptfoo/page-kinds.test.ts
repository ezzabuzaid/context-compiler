import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { TemporaryFiles } from '@zukhruf/testing/fs';
import { describe, test } from '@zukhruf/testing/node';

import { promptfoo } from '../src/testing/promptfoo.ts';

// The OpenRouter key in the harness's environment, which the decision model
// sends.
const openRouterKey = 'sk-or-v1-test-key';

// What OpenRouter's Decisions API answers for each page: the kind that Jev
// chooses, or an error in OpenRouter's error shape, at every request about
// the page. The shape is that of the 401 captured on 2026-10-31
// (src/startup-credits.test.ts); a 500 of the Decisions API was not
// captured, so its body takes the same shape.
type Decision =
  | { readonly kind: string }
  | { readonly status: number; readonly message: string };

// The internet as promptfoo's process sees it, loaded before promptfoo:
// OpenRouter's Decisions API answers a request with the test's key about a
// page whose text the request carries with its decision, in the shape of a
// real Jev 1.14 answer captured on 2026-10-31 (as src/startup-credits.test.ts
// answers it), and every other request fails.
const internet = (
  decisions: Readonly<Record<string, Decision>>,
  texts: Readonly<Record<string, string>>,
) => `
import { Msw } from ${JSON.stringify(import.meta.resolve('@zukhruf/testing/msw'))};
import { HttpResponse, http } from ${JSON.stringify(import.meta.resolve('msw'))};
const decisions = ${JSON.stringify(decisions)};
const texts = ${JSON.stringify(texts)};
new Msw().intercept(
  http.post('https://openrouter.ai/api/alpha/decisions', async ({ request }) => {
    const body = await request.json();
    const page = /^URL: (\\S+)$/mu.exec(body.state)?.[1];
    const decision = decisions[page];
    const criteria = Object.keys(body.questions.kind.criteria);
    if (
      decision === undefined ||
      !body.state.includes(texts[page]) ||
      request.headers.get('authorization') !== ${JSON.stringify(`Bearer ${openRouterKey}`)} ||
      ('kind' in decision && !criteria.includes(decision.kind))
    ) {
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
`;

// A frozen test page and the kind that its label gives it.
type Frozen = { readonly url: string; readonly kind: string };
const textOf = (page: Frozen) =>
  `The page at ${page.url}, which is a ${page.kind} page.`;
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
    role: 'test',
    kind: page.kind,
    offers: [],
    lookalikes: [],
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
  readonly evalId: string;
  readonly results: {
    readonly prompts: readonly {
      readonly metrics: {
        readonly namedScores: Readonly<Record<string, number>>;
        readonly namedScoreWeights: Readonly<Record<string, number>>;
      };
    }[];
    readonly results: readonly {
      readonly vars: Readonly<Record<string, unknown>>;
      readonly error?: string;
      readonly failureReason: number;
      readonly response?: {
        readonly output?: unknown;
        readonly metadata?: Readonly<Record<string, unknown>>;
      };
    }[];
  };
};

type Summary = {
  readonly eval_id: string;
  readonly summaries: readonly Readonly<Record<string, unknown>>[];
};

// A folder of its own for each eval, with this answer key and cache in place
// of the real ones, and a config that spreads the eval's page-kinds config,
// so the real generator, provider, assertion and summary run.
async function evalFolder(pages: readonly Frozen[]) {
  const folder = await new TemporaryFiles().directory('page-kinds-');
  await writeFile(
    join(folder.path, 'answer-key.json'),
    JSON.stringify(answerKeyOf(pages)),
  );
  await writeFile(
    join(folder.path, 'pages.json'),
    JSON.stringify(cacheOf(pages)),
  );
  await writeFile(
    join(folder.path, 'promptfooconfig.mjs'),
    `import config from ${JSON.stringify(join(import.meta.dirname, 'page-kinds.config.ts'))};
export default {
  ...config,
  tests: { ...config.tests, config: ${JSON.stringify({
    answerKey: join(folder.path, 'answer-key.json'),
    pages: join(folder.path, 'pages.json'),
  })} },
};
`,
  );
  return folder;
}

// Runs promptfoo with these arguments in the folder, with the Decisions API
// answering as planned, and gives what promptfoo printed.
async function answering(
  folder: string,
  pages: readonly Frozen[],
  decisions: Readonly<Record<string, Decision>>,
  args: readonly string[],
) {
  // Each run is a process of its own, with its own decisions.
  const stub = join(folder, 'internet.mjs');
  await writeFile(
    stub,
    internet(
      decisions,
      Object.fromEntries(pages.map((page) => [page.url, textOf(page)])),
    ),
  );
  const { stdout, stderr } = await promptfoo(folder, args, {
    imports: [stub],
    env: { OPENROUTER_API_KEY: openRouterKey },
  });
  assert.doesNotMatch(stderr, /unplanned decision/u, stderr);
  return stdout;
}

// Runs promptfoo eval with these arguments in the folder, with the Decisions
// API answering as planned. Gives the output file, the pooled score of each
// named score as [hits, whole], and what promptfoo printed. A run writes its
// eval to the folder's promptfoo database, which promptfoo retry <eval id>
// reads.
async function evaluate(
  folder: string,
  pages: readonly Frozen[],
  decisions: Readonly<Record<string, Decision>>,
  args: readonly string[],
) {
  const stdout = await answering(folder, pages, decisions, [
    'eval',
    ...args,
    '--no-cache',
    '--no-table',
    '-o',
    'out.json',
  ]);
  const run: Run = JSON.parse(await readFile(join(folder, 'out.json'), 'utf8'));
  const [prompt] = run.results.prompts;
  assert.ok(prompt);
  const { namedScores, namedScoreWeights } = prompt.metrics;
  const pooled = Object.fromEntries(
    Object.entries(namedScoreWeights).map(([name, whole]) => [
      name,
      [namedScores[name], whole],
    ]),
  );
  return { run, pooled, stdout };
}

// The summaries that afterAll wrote into the folder's results/.
async function summariesIn(folder: string): Promise<Summary[]> {
  const files = await readdir(join(folder, 'results')).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    },
  );
  return Promise.all(
    files.map(async (file) =>
      JSON.parse(await readFile(join(folder, 'results', file), 'utf8')),
    ),
  );
}

const program = { url: 'https://program.example/startups', kind: 'program' };
const home = { url: 'https://home.example/', kind: 'home' };
const missed = { url: 'https://missed.example/startups', kind: 'program' };
const list = { url: 'https://list.example/credits', kind: 'list' };
const investor = { url: 'https://investor.example/', kind: 'investor' };
const product = { url: 'https://product.example/pricing', kind: 'home' };
const pages = [program, home, missed, list, investor, product];
// The 500 that the AI SDK retries, so the page's call fails.
const decisions: Readonly<Record<string, Decision>> = {
  [program.url]: { kind: 'program' },
  [home.url]: { kind: 'program' },
  [missed.url]: { kind: 'home' },
  [list.url]: { status: 500, message: 'Internal server error' },
  [investor.url]: { kind: 'investor' },
  [product.url]: { kind: 'program' },
};

void describe(
  'the page-kinds eval over the test pages',
  // Three runs at once, as the CI runner has four CPUs.
  { concurrency: 3 },
  () => {
    void test('each column pools a score over the pages, for the page kinds that the labels and the answers hold, and a page whose call failed answers null, a miss of its kind with no column of its own', async () => {
      await using folder = await evalFolder(pages);
      const { run, pooled } = await evaluate(folder.path, pages, decisions, [
        '-c',
        'promptfooconfig.mjs',
      ]);

      assert.deepEqual(pooled, {
        accuracy: [2, 6],
        'home precision': [0, 1],
        'home recall': [0, 2],
        'home f1': [0, 3],
        'investor precision': [1, 1],
        'investor recall': [1, 1],
        'investor f1': [2, 2],
        'list recall': [0, 1],
        'list f1': [0, 1],
        'program precision': [1, 3],
        'program recall': [1, 2],
        'program f1': [2, 5],
      });
      const rows = new Map(
        run.results.results.map((row) => [row.vars['url'], row]),
      );
      const failed = rows.get(list.url)?.response;
      assert.equal(failed?.output, 'null');
      assert.match(
        String(failed?.metadata?.['failed']),
        /Internal server error/u,
      );
      const decided = rows.get(home.url)?.response;
      assert.equal(decided?.output, 'program');
      assert.equal(
        JSON.parse(String(decided?.metadata?.['answer']))['choice'],
        'program',
      );
      assert.match(
        String(decided?.metadata?.['harness']),
        /^typesafe\/jev-1\.14:/u,
      );
    });

    void test('the summary of a run has the confusion matrix, the macro and weighted precision, recall and F1, and the support of each kind, as scikit-learn 1.9.1 gives them', async () => {
      await using folder = await evalFolder(pages);
      await evaluate(folder.path, pages, decisions, [
        '-c',
        'promptfooconfig.mjs',
      ]);

      // scikit-learn 1.9.1 with labels=pageKinds (zero_division=0) on the
      // labels [program, home, program, list, investor, home] and the answers
      // [program, program, home, null, investor, program]: the answer null is
      // a miss of list and no pair of the matrix.
      const [summary, ...others] = await summariesIn(folder.path);
      assert.deepEqual(others, []);
      assert.deepEqual(summary?.summaries, [
        {
          provider: 'PageKinds',
          prompt_idx: 0,
          pages: 6,
          accuracy: 0.3333333333333333,
          precision: {
            macro: 0.19047619047619047,
            weighted: 0.27777777777777773,
          },
          recall: { macro: 0.21428571428571427, weighted: 0.3333333333333333 },
          f1: { macro: 0.19999999999999998, weighted: 0.3 },
          support: {
            program: 2,
            home: 2,
            list: 1,
            article: 0,
            other_program: 0,
            investor: 1,
            other: 0,
          },
          confusion_matrix: {
            labels: [
              'program',
              'home',
              'list',
              'article',
              'other_program',
              'investor',
              'other',
            ],
            rows: [
              [1, 1, 0, 0, 0, 0, 0],
              [2, 0, 0, 0, 0, 0, 0],
              [0, 0, 0, 0, 0, 0, 0],
              [0, 0, 0, 0, 0, 0, 0],
              [0, 0, 0, 0, 0, 0, 0],
              [0, 0, 0, 0, 0, 1, 0],
              [0, 0, 0, 0, 0, 0, 0],
            ],
          },
        },
      ]);
    });

    void test('a rejected key makes the page an error with no summary, a retry that fails again writes none either, and the retry that answers scores each page once', async () => {
      const three = [program, home, investor];
      const rejected = { status: 401, message: 'User not found.' };
      // The investor page answered program is a wrong answer: its row
      // fails its assertion, and it is not an error.
      const answered = {
        [program.url]: { kind: 'program' },
        [investor.url]: { kind: 'program' },
      };
      await using folder = await evalFolder(three);
      const first = await evaluate(
        folder.path,
        three,
        { ...answered, [home.url]: rejected },
        ['-c', 'promptfooconfig.mjs'],
      );
      const { evalId } = first.run;
      // A newer eval in the same database, over the first two pages, with an
      // error row of its own: a retry of the latest eval retries that one.
      await evaluate(
        folder.path,
        three,
        { ...answered, [home.url]: rejected },
        ['-c', 'promptfooconfig.mjs', '--filter-first-n', '2'],
      );
      const again = await answering(
        folder.path,
        three,
        { ...answered, [home.url]: rejected },
        ['retry', evalId],
      );
      const before = await summariesIn(folder.path);
      await answering(
        folder.path,
        three,
        { ...answered, [home.url]: { kind: 'home' } },
        ['retry', evalId],
      );

      const row = first.run.results.results.find(
        ({ vars }) => vars['url'] === home.url,
      );
      // ResultFailureReason.ERROR
      assert.equal(row?.failureReason, 2);
      assert.match(String(row?.error), /User not found/u);
      const retry = new RegExp(
        `^No summary: 1 rows are errors\\. Run them again with nx run startup-credits:promptfoo-retry --args=${RegExp.escape(evalId)}$`,
        'mu',
      );
      assert.match(first.stdout, retry);
      assert.match(again, retry);
      assert.deepEqual(before, []);
      const [summary, ...others] = await summariesIn(folder.path);
      assert.deepEqual(others, []);
      assert.equal(summary?.eval_id, evalId);
      const [scores] = summary?.summaries ?? [];
      assert.equal(scores?.['pages'], three.length);
      assert.deepEqual(scores?.['support'], {
        program: 1,
        home: 1,
        list: 0,
        article: 0,
        other_program: 0,
        investor: 1,
        other: 0,
      });
      assert.equal(scores?.['accuracy'], 2 / 3);
    });
  },
);
