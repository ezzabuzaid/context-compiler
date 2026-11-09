import { Output, generateText } from 'ai';
import { z } from 'zod';

import { type LoadedRow, Rule, type RuleResult } from '@eltjs/elt';
import { ruleIdentity } from '@workspace/model-calls/rule-identity';
import { ground } from '@workspace/quote-grounding';

import { callFailures } from '../call-failure.ts';
import model from './model.ts';

export type Page = {
  readonly url: string;
  readonly title: string | null;
  readonly text: string;
};

// The quote comes first, so the model copies the sentence that decides
// before it decides.
const answerSchema = z.object({
  quote: z.string().nullable(),
  satisfied: z.enum(['yes', 'no', 'unclear']),
  reasoning: z.string(),
});

const system =
  'You judge whether one web page meets one criterion. First copy, word for word, the one sentence of the page text that decides the criterion, as quote; null when no sentence does. Never quote the URL, the title or the criterion. Then answer satisfied: yes when the page shows that the criterion holds, no when the page shows that it does not, unclear when the page does not say. Then give the reasoning in one sentence.';

export const prompt = (instruction: string, { url, title, text }: Page) =>
  `${instruction}\nURL: ${url}\n${title === null ? '' : `Title: ${title}\n`}\n${text}`;

// Thinking counts toward maxOutputTokens, so the limit leaves room for it.
export const settings = { maxOutputTokens: 16_000 } as const;

// The pair of a row of judgment_inputs or field_inputs, and its page.
export function readPage(
  row: LoadedRow,
): { readonly pair: string; readonly page: Page } | null {
  const { pair, articleUrl, title, textContent } = row;
  return typeof pair === 'string' &&
    typeof articleUrl === 'string' &&
    (typeof title === 'string' || title === null) &&
    typeof textContent === 'string'
    ? { pair, page: { url: articleUrl, title, text: textContent } }
    : null;
}

// A page and a criterion that a dataset of the page asks.
type Judged = { readonly page: Page; readonly criterion: string };

// The text that a prompt shows in place of the page, for an identity.
export const placeholder: Page = {
  url: '{url}',
  title: '{title}',
  text: '{text}',
};

// Whether a page meets a criterion, as GPT-6-Luna reads the page. Each page
// and criterion is one input, whatever the datasets that ask it, so a pair
// that two datasets share is judged once. The quote stays only when it is in
// the page text, so an invented sentence is never the evidence of an
// evaluation.
export class Evaluation extends Rule<Judged, string> {
  override readonly key = {
    name: 'pair',
    description:
      'The article URL of the page and the criterion, as a JSON array.',
  };
  override readonly output = {
    satisfied: {
      type: 'text',
      description:
        'yes, no or unclear: whether the page shows that the criterion holds. NULL unless status is computed.',
    },
    reasoning: {
      type: 'text',
      description:
        "The model's reasoning, in one sentence. NULL unless status is computed.",
    },
    quote: {
      type: 'text',
      description:
        'The sentence of the page text that decides the criterion, or NULL when the page has none.',
    },
  } as const;
  // One page for each model call, four at once.
  override readonly batch = 1;
  override readonly concurrency = 4;

  override read(row: LoadedRow) {
    const read = readPage(row);
    const { criterion } = row;
    return read === null || typeof criterion !== 'string'
      ? null
      : { key: read.pair, input: { page: read.page, criterion } };
  }

  // The model and everything that it reads besides the page and the
  // criterion, so a changed prompt, schema or setting judges every page
  // again; a changed page or criterion is a changed input.
  override async identity(): Promise<string> {
    return ruleIdentity(model.modelId, {
      system,
      prompt: prompt('Criterion: {criterion}', placeholder),
      schema: z.toJSONSchema(answerSchema),
      settings,
    });
  }

  override async compute(
    inputs: readonly Judged[],
    signal?: AbortSignal,
  ): Promise<readonly RuleResult<Readonly<Record<string, string>>>[]> {
    return Promise.all(inputs.map((input) => this.#evaluate(input, signal)));
  }

  async #evaluate(
    { page, criterion }: Judged,
    signal: AbortSignal | undefined,
  ): Promise<RuleResult<Readonly<Record<string, string>>>> {
    let answer;
    try {
      ({ output: answer } = await generateText({
        model,
        instructions: system,
        prompt: prompt(`Criterion: ${criterion}`, page),
        output: Output.object({ schema: answerSchema }),
        ...settings,
        abortSignal: signal,
      }));
    } catch (error) {
      return { error: callFailures.reason(error) };
    }
    const { quote } = answer;
    const grounded = quote !== null && ground(page.text, quote) !== null;
    return {
      value: {
        satisfied: answer.satisfied,
        reasoning: answer.reasoning,
        ...(grounded ? { quote } : {}),
      },
    };
  }
}
