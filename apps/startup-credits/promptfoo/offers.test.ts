import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { TemporaryFiles } from '@zukhruf/testing/fs';

// promptfoo's command line, beside its main module (dist/src/index.js).
const promptfoo = join(
  dirname(fileURLToPath(import.meta.resolve('promptfoo'))),
  'entrypoint.js',
);

const mention = { start: 1701, end: 1868 };
const credits = {
  kind: 'credits',
  value: { amount: 30000, currency: 'USD' },
  mentions: [mention],
};
const support = { kind: 'support', value: null, mentions: [mention] };
// Offers as the harness stores them (storedOffersSchema): a support offer has
// no value and no duration.
const statedCredits = {
  kind: 'credits',
  value: credits.value,
  quote: 'q',
  duration: null,
  who: null,
  span: mention,
};
const statedSupport = { kind: 'support', quote: 'q', who: null, span: mention };

test('a promptfoo run shows the offers assertion pooled over its rows: all right values over all expected values, not the mean of the rows', async () => {
  await using folder = await new TemporaryFiles().directory('offers-run-');
  const outputs = {
    a: { offers: [statedCredits, statedSupport] },
    b: { offers: [] },
  };
  await writeFile(
    join(folder.path, 'provider.mjs'),
    `const outputs = ${JSON.stringify(outputs)};
export default class Fixed {
  id() { return 'fixed'; }
  async callApi(prompt, context) { return { output: outputs[context.vars.url] }; }
}
`,
  );
  const row = (url: string, expected: unknown) => ({
    vars: { url },
    assert: [
      {
        type: 'javascript',
        value: `file://${join(import.meta.dirname, 'assertions/offers.ts')}`,
        config: { expected },
      },
    ],
  });
  await writeFile(
    join(folder.path, 'promptfooconfig.yaml'),
    JSON.stringify({
      prompts: ['{{url}}'],
      providers: [`file://${join(folder.path, 'provider.mjs')}`],
      tests: [
        row('a', { offers: [credits, support] }),
        row('b', { offers: [credits] }),
      ],
    }),
  );

  await promisify(execFile)(
    process.execPath,
    [
      promptfoo,
      'eval',
      '-c',
      'promptfooconfig.yaml',
      '--no-write',
      '--no-cache',
      '-o',
      'out.json',
    ],
    {
      cwd: folder.path,
      timeout: 120_000,
      // Only what promptfoo needs: its own data folder, and nothing sent out.
      env: {
        PATH: process.env['PATH'],
        HOME: folder.path,
        PROMPTFOO_CONFIG_DIR: join(folder.path, '.promptfoo'),
        PROMPTFOO_DISABLE_TELEMETRY: '1',
        PROMPTFOO_DISABLE_UPDATE: '1',
        PROMPTFOO_DISABLE_SHARING: 'true',
        PROMPTFOO_PASS_RATE_THRESHOLD: '0',
      },
    },
  );
  const out: {
    readonly results: {
      readonly prompts: readonly {
        readonly metrics: {
          readonly namedScores: Readonly<Record<string, number>>;
          readonly namedScoreWeights: Readonly<Record<string, number>>;
        };
      }[];
    };
  } = JSON.parse(await readFile(join(folder.path, 'out.json'), 'utf8'));

  const [prompt] = out.results.prompts;
  assert.ok(prompt);
  const { namedScores, namedScoreWeights } = prompt.metrics;
  // Row a states 4 of its 4 expected values, row b 0 of its 3: pooled, 4/7;
  // the mean of the rows would be 1/2.
  assert.equal(namedScoreWeights['recall'], 7);
  assert.equal(namedScores['recall'], 4);
  assert.equal(
    (namedScores['recall'] ?? 0) / (namedScoreWeights['recall'] ?? 1),
    4 / 7,
  );
  assert.notEqual(4 / 7, (1 + 0) / 2);
  assert.equal(namedScoreWeights['valid'], 2);
  assert.equal(namedScores['valid'], 2);
});
