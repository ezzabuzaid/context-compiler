import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  CoalescingDecisionModel,
  DecisionScorer,
  type Scores,
  type Stream,
} from '@zukhruf/relevance-filtering';
import { Declaration } from '@zukhruf/sqlite-drift';
import {
  APICallError,
  Experimental_DecisionRefusalError,
  RetryError,
} from 'ai';
import { z } from 'zod';

import d1 from './decision-model.ts';
import directory from './directory.ts';
import type { Interest } from './settings.ts';

// What the decision model answered, by the text of an article and the
// question. One question about one text has one answer, so the pipeline asks
// when reports arrive and a page reads the answer; a new or edited sentence
// is asked at its first miss (#3430). A run can make every row again.
const declaration = new Declaration(
  [
    `CREATE TABLE decision (
      state TEXT NOT NULL,
      question TEXT NOT NULL,
      probability REAL NOT NULL,
      PRIMARY KEY (state, question)
    ) STRICT`,
  ],
  { rows: 'replace' },
);
const db = new DatabaseSync(join(directory, 'decisions.sqlite'), {
  timeout: 5_000,
});
declaration.apply(db);
const read = db.prepare(
  'SELECT probability FROM decision WHERE state = ? AND question = ?',
);
const write = db.prepare(
  `INSERT INTO decision (state, question, probability) VALUES (?, ?, ?)
  ON CONFLICT (state, question) DO UPDATE SET probability = excluded.probability`,
);
const rowSchema = z.object({ probability: z.number() });

// The questions that the interests ask about one article in one turn of the
// event loop go to d1 as one call, which answers them in one pass.
const coalesced = new CoalescingDecisionModel(d1);

// The decision model behind the table: it reads the stored answer and asks
// the model only on a miss. DecisionScorer asks one boolean question about one
// text, so any other call is refused.
const cached: typeof d1 = {
  specificationVersion: d1.specificationVersion,
  provider: d1.provider,
  modelId: d1.modelId,
  supportedQuestionTypes: d1.supportedQuestionTypes,
  async doDecide(options) {
    const [part, ...otherParts] = options.state;
    const [entry, ...otherQuestions] = Object.entries(options.questions);
    if (
      part?.type !== 'text' ||
      otherParts.length > 0 ||
      entry === undefined ||
      otherQuestions.length > 0
    )
      throw new Error('Expected one text and one question.');
    const [id, question] = entry;
    if (
      question.type !== 'boolean' ||
      typeof question.instructions !== 'string'
    )
      throw new Error('Expected a boolean question with instructions.');
    const row = read.get(part.text, question.instructions);
    if (row !== undefined)
      return {
        answers: {
          [id]: {
            type: 'boolean',
            probability: rowSchema.parse(row).probability,
          },
        },
        warnings: [],
      };
    const result = await coalesced.doDecide(options);
    const answer = result.answers[id];
    if (answer?.type === 'boolean')
      write.run(part.text, question.instructions, answer.probability);
    return result;
  },
};

// The text of an article that the decision model reads: its title and lead,
// the same for the pipeline and a page, so a page finds the stored answers.
export function articleText(report: {
  readonly title: string;
  readonly lead: string;
}): string {
  return `${report.title} ${report.lead}`;
}

// The scores of one interest, by its sentence or its name when it has none,
// or undefined when the decision model did not answer (#3430: no other ranker
// stands in).
export async function score(
  interest: Interest,
  stream: Stream,
  options: { readonly signal: AbortSignal },
): Promise<Scores | undefined> {
  try {
    return await new DecisionScorer({
      model: cached,
      description: interest.sentence || interest.name,
    }).score(stream, options);
  } catch (error) {
    if (
      error instanceof APICallError ||
      error instanceof RetryError ||
      error instanceof Experimental_DecisionRefusalError
    )
      return undefined;
    throw error;
  }
}
