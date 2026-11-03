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
import model from './criterion-model.ts';

type Page = {
  readonly url: string;
  readonly title: string | null;
  readonly text: string;
};

// The quote comes first, so the model copies the sentence that decides
// before it decides.
const verdictSchema = z.object({
  quote: z.string().nullable(),
  meets: z.boolean(),
  reason: z.string(),
});

const system =
  'You judge whether one startup program, as its web page describes it, meets one criterion. First copy, word for word, the one sentence of the page text that decides the criterion, as quote; null when no sentence does. Never quote the URL, the title or the criterion. Then answer meets: true only when the page shows that the criterion holds; false when the page shows that it does not, or says nothing about it. Then give the reason in one sentence.';

const prompt = (criterion: string, { url, title, text }: Page) =>
  `Criterion: ${criterion}\nURL: ${url}\n${title === null ? '' : `Title: ${title}\n`}\n${text}`;

// Thinking counts toward maxOutputTokens, so the limit leaves room for it.
const settings = { maxOutputTokens: 16_000 } as const;

// Whether each program page meets one criterion of a query, as GPT-6-Luna
// reads the page. The quote stays only when it is in the page text, so an
// invented sentence is never the evidence of a verdict.
export class CriterionVerdicts extends Rule<Page, string> {
  readonly #criterion: string;

  override readonly key = {
    name: 'articleUrl',
    description: 'The article URL of the program page.',
  };
  override readonly output = {
    meets: {
      type: 'text',
      description:
        'yes when the page shows that the criterion holds, else no. NULL unless status is computed.',
    },
    reason: {
      type: 'text',
      description:
        "The model's reason, in one sentence. NULL unless status is computed.",
    },
    quote: {
      type: 'text',
      description:
        'The sentence of the page text that decides the criterion, or NULL when the page has none.',
    },
  } as const;
  // One page for each model call, four at once, as the offers.
  override readonly batch = 1;
  override readonly concurrency = 4;

  constructor(criterion: string) {
    super();
    this.#criterion = criterion;
  }

  override read(
    row: LoadedRow,
  ): { readonly key: string; readonly input: Page } | null {
    const { articleUrl, title, textContent } = row;
    return typeof articleUrl === 'string' &&
      (typeof title === 'string' || title === null) &&
      typeof textContent === 'string'
      ? {
          key: articleUrl,
          input: { url: articleUrl, title, text: textContent },
        }
      : null;
  }

  // The model and everything that it reads besides the page, so a changed
  // prompt, schema or setting judges every page again.
  override async identity(): Promise<string> {
    return `${model.modelId}:${createHash('sha256')
      .update(
        JSON.stringify({
          system,
          prompt: prompt(this.#criterion, {
            url: '{url}',
            title: '{title}',
            text: '{text}',
          }),
          schema: z.toJSONSchema(verdictSchema),
          settings,
        }),
      )
      .digest('hex')}`;
  }

  override async compute(
    pages: readonly Page[],
    signal?: AbortSignal,
  ): Promise<readonly RuleResult<Readonly<Record<string, string>>>[]> {
    return Promise.all(pages.map((page) => this.#verdict(page, signal)));
  }

  async #verdict(
    page: Page,
    signal: AbortSignal | undefined,
  ): Promise<RuleResult<Readonly<Record<string, string>>>> {
    let verdict;
    try {
      ({ output: verdict } = await generateText({
        model,
        instructions: system,
        prompt: prompt(this.#criterion, page),
        output: Output.object({ schema: verdictSchema }),
        ...settings,
        abortSignal: signal,
      }));
    } catch (error) {
      // As ProgramOffers decides (docs/copied-code.md): an answer with no
      // verdict in it, or a call that failed after the retries, is this
      // page's failure; a rejected token fails every page, so it fails the
      // dataset. A stop is no failure.
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
    const grounded =
      verdict.quote === null || ground(page.text, verdict.quote) === null
        ? null
        : verdict.quote;
    return {
      value: {
        meets: verdict.meets ? 'yes' : 'no',
        reason: verdict.reason,
        ...(grounded === null ? {} : { quote: grounded }),
      },
    };
  }
}
