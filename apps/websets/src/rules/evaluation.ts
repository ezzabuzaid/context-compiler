import { createHash } from 'node:crypto';

import {
  APICallError,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
  RetryError,
  generateText,
} from 'ai';
import { z } from 'zod';

import { type LoadedRow, Rule, type RuleResult } from '@workspace/elt';

import { ground } from '../ground.ts';
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

export function readPage(
  row: LoadedRow,
): { readonly key: string; readonly input: Page } | null {
  const { articleUrl, title, textContent } = row;
  return typeof articleUrl === 'string' &&
    (typeof title === 'string' || title === null) &&
    typeof textContent === 'string'
    ? { key: articleUrl, input: { url: articleUrl, title, text: textContent } }
    : null;
}

// A call that failed after the AI SDK's retries is the failure of one page,
// as startup-credits' ProgramOffers decides (docs/copied-code.md); a
// rejected token fails every page, so it fails the dataset. A stop is no
// failure.
export function pageFailure(error: unknown): { readonly error: string } {
  if (
    NoObjectGeneratedError.isInstance(error) ||
    NoOutputGeneratedError.isInstance(error)
  ) {
    return { error: error.message };
  }
  const call = RetryError.isInstance(error) ? error.lastError : error;
  if (APICallError.isInstance(call) && call.statusCode !== 401) {
    return { error: call.message };
  }
  throw error;
}

// Whether each page of a collection meets one of its criteria, as
// GPT-6-Luna reads the page. The quote stays only when it is in the page
// text, so an invented sentence is never the evidence of an evaluation.
export class Evaluation extends Rule<Page, string> {
  readonly #criterion: string;

  override readonly key = {
    name: 'articleUrl',
    description: 'The article URL of the page.',
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

  constructor(criterion: string) {
    super();
    this.#criterion = criterion;
  }

  override read(row: LoadedRow) {
    return readPage(row);
  }

  // The model and everything that it reads besides the page, so a changed
  // prompt, schema or setting judges every page again.
  override async identity(): Promise<string> {
    return `${model.modelId}:${createHash('sha256')
      .update(
        JSON.stringify({
          system,
          prompt: prompt(`Criterion: ${this.#criterion}`, {
            url: '{url}',
            title: '{title}',
            text: '{text}',
          }),
          schema: z.toJSONSchema(answerSchema),
          settings,
        }),
      )
      .digest('hex')}`;
  }

  override async compute(
    pages: readonly Page[],
    signal?: AbortSignal,
  ): Promise<readonly RuleResult<Readonly<Record<string, string>>>[]> {
    return Promise.all(pages.map((page) => this.#evaluate(page, signal)));
  }

  async #evaluate(
    page: Page,
    signal: AbortSignal | undefined,
  ): Promise<RuleResult<Readonly<Record<string, string>>>> {
    let answer;
    try {
      ({ output: answer } = await generateText({
        model,
        instructions: system,
        prompt: prompt(`Criterion: ${this.#criterion}`, page),
        output: Output.object({ schema: answerSchema }),
        ...settings,
        abortSignal: signal,
      }));
    } catch (error) {
      return pageFailure(error);
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
