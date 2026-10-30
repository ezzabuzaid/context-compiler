import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { createTypeSafeAi } from '@ai-sdk/typesafe-ai';
import { experimental_decide as decide } from 'ai';
import { z } from 'zod';

import { answerKey, pageKinds } from './answer-key.ts';
import { scoreKinds } from './kind-score.ts';
import { pages } from './pages.ts';

const { values } = parseArgs({ options: { model: { type: 'string' } } });
const name = values.model;
if (name === undefined)
  throw new Error(
    '--model takes an OpenRouter decision model id, such as typesafe/jev-1.14',
  );

// OpenRouter's Decisions API speaks TypeSafe's wire format at /decisions. Its
// own provider (3.1.0) types its model against an older decision spec than
// ai 7, so the TypeSafe provider is pointed at it instead.
const model = createTypeSafeAi({
  baseURL: 'https://openrouter.ai/api/alpha',
  apiKey: process.env.OPENROUTER_API_KEY,
  fetch: (url, init) =>
    fetch(String(url).replace(/\/systemone$/u, '/decisions'), init),
}).decisionModel(name);

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

// OpenRouter answered 16 requests at once with no refusal (2026-10-31).
const inFlight = 16;

const key = answerKey();
const texts = pages();
const tests = key.pages.flatMap((label) => {
  if (label.role !== 'test') return [];
  const page = texts.get(label.url);
  if (page?.sha256 !== label.sha256)
    throw new Error(`${label.url}: the cache holds other text than the labels`);
  return [{ label, page }];
});
const ranAt = new Date().toISOString();
const runs = join(import.meta.dirname, 'runs');
const file = `${ranAt.slice(0, 19).replaceAll(':', '-')}-${name.replaceAll('/', '_')}.json`;
mkdirSync(runs, { recursive: true });

const answers = new Map<string, string>();
const failed: string[] = [];
// The ids the provider answered with: more than one means the model behind
// the pinned name changed during the run.
const modelIds = new Set<string>();
// Written after each page in the order of the labels, so a run that stops
// keeps what it answered and two runs compare line by line.
function save() {
  const answered = tests.flatMap(({ label }) => {
    const kind = answers.get(label.url);
    return kind === undefined ? [] : [{ url: label.url, kind, offers: [] }];
  });
  writeFileSync(
    join(runs, file),
    JSON.stringify(
      { extractor: `${name} page kinds`, pages: answered },
      null,
      1,
    ),
  );
}
// Each loop takes the next page from the one shared queue.
const queue = tests.values();
async function decideAll() {
  for (const { label, page } of queue) {
    try {
      const { answers: answer, response } = await decide({
        model,
        state: `URL: ${page.url}\nTitle: ${page.title}\n\n${page.text}`.slice(
          0,
          20_000,
        ),
        questions,
      });
      modelIds.add(response.modelId);
      answers.set(label.url, answer.kind.choice);
    } catch (error) {
      failed.push(label.url);
      console.log(
        `could not decide ${label.url}: ${Error.isError(error) ? error.message : String(error)}`,
      );
    }
    save();
  }
}
await Promise.all(Array.from({ length: inFlight }, decideAll));

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
