import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { createTypeSafeAi } from '@ai-sdk/typesafe-ai';
import {
  type Experimental_DecisionModel,
  experimental_decide as decide,
} from 'ai';
import { z } from 'zod';

import { answerKey, pageKinds } from './answer-key.ts';
import { scoreKinds } from './kind-score.ts';
import { pages } from './pages.ts';

// The decision models the benchmark compares, each pinned to one version so
// that a run can be repeated.
const models = new Map<string, () => Experimental_DecisionModel>([
  // OpenRouter's Decisions API speaks the same wire format at /decisions. Its
  // own provider (3.1.0) types its model against an older decision spec than
  // ai 7, so the TypeSafe provider is pointed at it instead.
  [
    'jev-1.14',
    () =>
      createTypeSafeAi({
        baseURL: 'https://openrouter.ai/api/alpha',
        apiKey: process.env.OPENROUTER_API_KEY,
        fetch: (url, init) =>
          fetch(String(url).replace(/\/systemone$/u, '/decisions'), init),
      }).decisionModel('typesafe/jev-1.14'),
  ],
]);

// Every model gets the same question, with one criterion for each kind that
// the labels use.
const questions = {
  kind: {
    type: 'choice',
    instructions: 'What kind of web page is this?',
    criteria: {
      program: "one company's program page for startups",
      home: "a company's home page or product page",
      list: 'a list or directory of many programs from many companies',
      article: 'a blog post, news article or documentation page',
      other_program: 'a program for students, open source or ambassadors',
      investor: 'a venture fund, investor or accelerator',
      other:
        'a sign-in wall, loading screen, error page or a page with almost no text',
    } satisfies Record<(typeof pageKinds)[number], string>,
  },
} as const;

const { values } = parseArgs({ options: { model: { type: 'string' } } });
const name = values.model;
const create = name === undefined ? undefined : models.get(name);
if (name === undefined || create === undefined)
  throw new Error(`--model must be one of ${[...models.keys()].join(', ')}`);
const model = create();

const key = answerKey();
const texts = pages();
const ranAt = new Date().toISOString();
const runs = join(import.meta.dirname, 'runs');
const file = `${ranAt.slice(0, 19).replaceAll(':', '-')}-${name}.json`;
mkdirSync(runs, { recursive: true });

const predictions: {
  extractor: string;
  pages: { url: string; kind: string; offers: [] }[];
} = { extractor: `${name} page kinds`, pages: [] };
const answers = new Map<string, string>();
const failed: string[] = [];
// The ids the provider answered with: more than one means the model behind
// the pinned name changed during the run.
const modelIds = new Set<string>();
for (const label of key.pages.filter(({ role }) => role === 'test')) {
  const page = texts.get(label.url);
  if (page?.sha256 !== label.sha256)
    throw new Error(`${label.url}: the cache holds other text than the labels`);
  try {
    const { answers: answer, response } = await decide({
      model,
      state: `URL: ${page.url}\nTitle: ${page.title}\n\n${page.text}`.slice(
        0,
        20_000,
      ),
      questions,
    });
    const kind = answer.kind.choice;
    modelIds.add(response.modelId);
    answers.set(label.url, kind);
    predictions.pages.push({ url: label.url, kind, offers: [] });
  } catch (error) {
    failed.push(label.url);
    console.log(
      `could not decide ${label.url}: ${Error.isError(error) ? error.message : String(error)}`,
    );
  }
  // Written after each page, so a run that stops keeps what it answered.
  writeFileSync(join(runs, file), JSON.stringify(predictions, null, 1));
}

const { pages: answered, right, confusions } = scoreKinds(key.pages, answers);
const row = {
  model: name,
  modelIds: [...modelIds],
  ranAt,
  answered,
  failed: failed.length,
  right,
  confusions: Object.fromEntries(confusions),
  predictions: `runs/${file}`,
};
const scoreboard = join(import.meta.dirname, 'scoreboard.json');
// The rows of earlier runs; the first run finds no scoreboard.
function rows(): unknown[] {
  try {
    return z
      .array(z.unknown())
      .parse(JSON.parse(readFileSync(scoreboard, 'utf8')));
  } catch (error) {
    if (Error.isError(error) && 'code' in error && error.code === 'ENOENT')
      return [];
    throw error;
  }
}
writeFileSync(scoreboard, JSON.stringify([...rows(), row], null, 2) + '\n');
console.log(
  `${name} (${[...modelIds].join(', ')}): ${right}/${answered} page kinds right, ${failed.length} failed; ${[...confusions].map(([confusion, count]) => `${confusion} ${count}`).join(', ')}`,
);
